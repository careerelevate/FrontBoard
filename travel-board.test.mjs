import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";

const busTicketText = `E-Ticket
Bus Booking
Ticket
ID:
CBSU28GB
PNR:
ALAQBLMBQ694
Tirunelveli
Velankanni
ALAYA ROAD LINES
NON A/C Sleeper (2+1)
Boarding Point:
10:30 PM
Sun, 27 Dec
Tirunelveli bus stop
Drop Point:
06:20 AM
Mon, 28 Dec
Velankanni bus stand
Traveller Details
Example Passenger
Female, 18 years
LW1`;

const flightWithHotelText = `Turkish Airlines
Flight itinerary
Airline Booking Reference: ABCDEF
Airways TK 1234
Departure 27 November 2026 10:30 AM Istanbul (IST)
Arrival 27 November 2026 2:30 PM London (LHR)
Hotel reservation
Check-in 27 November 2026`;

function createElement() {
  return {
    children: [],
    classList: { add() {}, remove() {} },
    addEventListener() {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {},
    querySelector() { return createElement(); },
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    dataset: {}
  };
}

async function loadFrontBoardScript(configureWindow) {
  const elements = new Map();
  const document = {
    querySelector: (selector) => {
      if (!elements.has(selector)) elements.set(selector, createElement());
      return elements.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement
  };
  const window = {
    document,
    listeners: {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
    confirm: () => true,
    alert() {},
    FRONTBOARD_CONFIG: {}
  };
  configureWindow?.(window);
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const context = createContext({ document, window, localStorage, setInterval() {} });
  const source = await readFile(new URL("./script.js", import.meta.url), "utf8");
  runInContext(source, context);
  return context;
}

test("classifies a PDF-extracted bus ticket as Bus and stores normalized dates", async () => {
  const board = await loadFrontBoardScript();
  const [ticket] = board.parseDocument("bus-ticket.pdf", busTicketText);

  assert.equal(ticket.type, "Bus");
  assert.equal(ticket.intelligence.document_type, "Bus");
  assert.equal(ticket.number, "CBSU28GB");
  assert.equal(ticket.pnr, "ALAQBLMBQ694");
  assert.match(ticket.date, /^\d{4}-12-27 → \d{4}-12-28$/);
  assert.equal(ticket.passengers[0].name, "Example Passenger");
});

test("keeps flight segments classified as Flight when the itinerary mentions hotels", async () => {
  const board = await loadFrontBoardScript();
  const [ticket] = board.parseDocument("itinerary.pdf", flightWithHotelText);
  const legacyRecord = board.travelJsonToTicket({
    evidence: flightWithHotelText,
    document: {
      document_type: "Hotel",
      booking_reference: "ABCDEF",
      itinerary: [{ departure_date: "2026-11-27", origin: "Istanbul", destination: "London" }],
      passengers: []
    }
  });

  assert.equal(ticket.type, "Flight");
  assert.equal(ticket.intelligence.document_type, "Flight");
  assert.equal(legacyRecord.type, "Flight");
});

test("shows only flights in the Flights view and only buses in the Bus view", async () => {
  const board = await loadFrontBoardScript();
  const futureFlightText = flightWithHotelText.replaceAll("27 November 2026", "27 November 2099");
  const futureBusText = busTicketText.replace("27 Dec", "27 Dec 2099").replace("28 Dec", "28 Dec 2099");
  await board.processFiles([
    { name: "itinerary.txt", text: async () => futureFlightText },
    { name: "bus-ticket.txt", text: async () => futureBusText }
  ]);

  board.setActiveView("Flights");
  board.renderTickets();
  const flightView = board.document.querySelector("#ticket-list").innerHTML;
  assert.match(flightView, /TK1234/);
  assert.doesNotMatch(flightView, /CBSU28GB/);

  board.setActiveView("Bus");
  board.renderTickets();
  const busView = board.document.querySelector("#ticket-list").innerHTML;
  assert.match(busView, /CBSU28GB/);
  assert.doesNotMatch(busView, /TK1234/);
});

test("keeps the Google account preview hidden until the user opens sign-in", async () => {
  const renderedButtons = [];
  const board = await loadFrontBoardScript((window) => {
    window.FRONTBOARD_CONFIG = { googleClientId: "test-client-id" };
    window.google = {
      accounts: {
        id: {
          initialize() {},
          renderButton(element) { renderedButtons.push(element); },
          prompt() {}
        }
      }
    };
  });

  assert.equal(renderedButtons.length, 0);
  board.window.listeners.load?.();
  assert.equal(renderedButtons.length, 0);

  board.initializeGoogleIdentity();
  assert.equal(renderedButtons.length, 1);
  assert.equal(board.document.querySelector("#google-sign-in-fallback").hidden, false);
});

test("reclassifies previously saved bus JSON and routes trips by travel month", async () => {
  const board = await loadFrontBoardScript();
  const year = new Date().getFullYear();
  const legacyRecord = {
    evidence: busTicketText,
    document: {
      document_type: "Flight",
      itinerary: [{ departure_date: "Sun, 27 Dec → Mon, 28 Dec" }],
      passengers: []
    }
  };
  const reloadedTicket = board.travelJsonToTicket(legacyRecord);

  assert.equal(reloadedTicket.type, "Bus");
  assert.match(reloadedTicket.date, /^\d{4}-12-27 → \d{4}-12-28$/);
  assert.equal(board.isTravelHistory({ date: "2026-10-31" }, new Date("2026-11-26T16:00:00Z")), true);
  assert.equal(board.isTravelHistory({ date: "2026-11-01" }, new Date("2026-11-26T16:00:00Z")), false);
  assert.equal(board.isTravelHistory({ date: "2026-12-27" }, new Date("2026-11-26T16:00:00Z")), false);
  assert.equal(
    board.normalizeTravelDateRange("31 Dec → 1 Jan", ""),
    `${year}-12-31 → ${year + 1}-01-01`
  );
});

test("reloads saved plans after sign-in and displays them in the appropriate view", async () => {
  const board = await loadFrontBoardScript();
  const futureDate = `${new Date().getFullYear() + 1}-12-27`;
  board.window.frontboardStorage = {
    signInWithGoogle: async () => ({
      user_metadata: { full_name: "Test User" },
      email: "test@example.com"
    }),
    listDocuments: async () => ({
      documents: [{
        id: "saved-document",
        source_document: "bus-ticket.txt",
        uploadedAt: new Date().toISOString(),
        fileExtension: "txt",
        recordCount: 1,
        records: [{
          source_document: "bus-ticket.txt",
          evidence: busTicketText,
          document: {
            document_type: "Flight",
            booking_reference: "CBSU28GB",
            itinerary: [{
              departure_date: futureDate,
              departure_time: "10:30 PM",
              origin: "Tirunelveli",
              destination: "Velankanni"
            }],
            passengers: [{ name: "Example Passenger", gender: "Female", age: "18", seat: "LW1" }]
          }
        }]
      }]
    })
  };

  await board.handleGoogleCredential({ credential: "test-token" });

  assert.equal(board.document.querySelector("#view-title").textContent, "Upcoming tickets");
  assert.match(board.document.querySelector("#ticket-list").innerHTML, /▰ Bus/);
  assert.match(board.document.querySelector("#ticket-list").innerHTML, /CBSU28GB/);
  assert.match(board.document.querySelector("#storage-status").textContent, /1 upcoming plan/);
});
