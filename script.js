const ticketList = document.querySelector("#ticket-list");
const ticketSearch = document.querySelector("#ticket-search");
const documentUpload = document.querySelector("#document-upload");
const dropZone = document.querySelector("#drop-zone");
const loadedFiles = document.querySelector("#loaded-files");
const uploadStatus = document.querySelector("#upload-status");
const fileCount = document.querySelector("#file-count");
const clearTickets = document.querySelector("#clear-tickets");
const storageStatus = document.querySelector("#storage-status");
const savedDocumentsElement = document.querySelector("#saved-documents");
const savedDocumentCount = document.querySelector("#saved-document-count");
const storageConsentDialog = document.querySelector("#storage-consent-dialog");
const storageConsentCheckbox = document.querySelector("#storage-consent-checkbox");
const storageConsentAccept = document.querySelector("#storage-consent-accept");
const storageConsentDecline = document.querySelector("#storage-consent-decline");

let tickets = [];
let activeFilter = "All tickets";
let supabaseUser = null;
let googleIdentityInitialized = false;
let pendingStorageUploads = [];
let cloudDocuments = [];
let storageConsentResolver = null;

function savedUserIsSignedIn() {
  try {
    const user = JSON.parse(localStorage.getItem("frontboard-user") || "null");
    return Boolean(user?.name);
  } catch {
    return false;
  }
}

const appShell = document.querySelector("#app-shell");
const signInFallback = document.querySelector("#google-sign-in-fallback");
const signedInUser = document.querySelector("#signed-in-user");
const signedInName = document.querySelector("#signed-in-name");
const signedInAvatar = document.querySelector("#signed-in-avatar");
const signInDialog = document.querySelector("#sign-in-dialog");
const googleProvider = document.querySelector("#google-provider");
const githubProvider = document.querySelector("#github-provider");
const accountMenu = document.querySelector("#account-menu");
const signOutButton = document.querySelector("#sign-out-button");

signedInUser.addEventListener("click", () => {
  accountMenu.hidden = !accountMenu.hidden;
});

signOutButton.addEventListener("click", async () => {
  try {
    await window.frontboardStorage.signOut();
  } catch (error) {
    storageStatus.textContent = `Could not sign out: ${error.message}`;
    return;
  }

  accountMenu.hidden = true;
  pendingStorageUploads = [];
  supabaseUser = null;
  cloudDocuments = [];
  tickets = [];
  loadedFiles.replaceChildren();
  fileCount.textContent = "0";
  clearTickets.disabled = true;
  localStorage.removeItem("frontboard-user");
  signedInUser.hidden = true;
  signInFallback.hidden = false;
  ticketSearch.value = "";
  setActiveView("All tickets");
  savedDocumentsElement.replaceChildren();
  const emptyMessage = document.createElement("p");
  emptyMessage.className = "saved-documents-empty";
  emptyMessage.textContent = "Sign in to view your saved documents.";
  savedDocumentsElement.append(emptyMessage);
  savedDocumentCount.textContent = "0";
  storageStatus.textContent = "Sign in with Google to access private cloud documents.";
  renderTickets();
  const footerName = document.querySelector(".sidebar-footer strong");
  const footerRole = document.querySelector(".sidebar-footer small");
  if (footerName) footerName.textContent = "FrontBoard";
  if (footerRole) footerRole.textContent = "Travel desk";
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".account-control")) accountMenu.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") accountMenu.hidden = true;
});

signInFallback.addEventListener("click", () => {
  if (typeof signInDialog?.showModal === "function") signInDialog.showModal();
});

googleProvider.addEventListener("click", () => {
  signInDialog.close();
  initializeGoogleIdentity();
  if (window.google?.accounts?.id) window.google.accounts.id.prompt();
});

githubProvider.addEventListener("click", () => {
  signInDialog.close();
  const config = window.FRONTBOARD_CONFIG;
  if (!config?.githubClientId) {
    window.alert("GitHub sign-in needs a GitHub OAuth client ID in frontboard-config.js.");
    return;
  }
  const redirectUri = `${window.location.origin}${window.location.pathname}`;
  const state = crypto.randomUUID?.() || String(Date.now());
  sessionStorage.setItem("frontboard-github-state", state);
  window.location.assign(`https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.githubClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${encodeURIComponent(state)}`);
});

function updateClock() {
  const now = new Date();
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(now);

  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short"
  }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value || "EST";

  document.querySelector("#est-clock").textContent = time;
  document.querySelector("#est-period").textContent = zone;
  document.querySelector("#est-date").textContent = date;
}

function setActiveView(view) {
  activeFilter = view;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.view === view) item.classList.add("active");
  });
  const titles = {
    "All tickets": "Upcoming tickets",
    Flights: "Upcoming flights",
    Bus: "Upcoming bus trips",
    "Travel history": "Travel history"
  };
  document.querySelector("#view-title").textContent = titles[view] || "Upcoming tickets";
}

updateClock();
setInterval(updateClock, 1000);

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    setActiveView(item.dataset.view);
    renderTickets();
  });
});

ticketSearch.addEventListener("input", renderTickets);

documentUpload.addEventListener("change", () => {
  processFiles([...documentUpload.files]);
  documentUpload.value = "";
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  processFiles([...event.dataTransfer.files]);
});

clearTickets.addEventListener("click", () => {
  tickets = [];
  loadedFiles.replaceChildren();
  fileCount.textContent = "0";
  uploadStatus.textContent = "Waiting for a document";
  clearTickets.disabled = true;
  renderTickets();
});

window.addEventListener("load", initializeGoogleIdentity);

async function handleGoogleCredential(response) {
  let authUser;
  try {
    authUser = await window.frontboardStorage.signInWithGoogle(response.credential);
  } catch (error) {
    supabaseUser = null;
    storageStatus.textContent = `Google sign-in failed: ${error.message}`;
    return;
  }

  supabaseUser = authUser;
  ticketSearch.value = "";
  setActiveView("All tickets");
  const user = {
    name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email || "Google user",
    email: authUser.email || ""
  };
  showSignedInUser(user);
  try {
    await loadSavedDocuments();
  } catch (error) {
    storageStatus.textContent = `Could not load your saved documents: ${error.message}`;
  }

  let uploadedPendingFile = false;
  while (pendingStorageUploads.length) {
    const pending = pendingStorageUploads.shift();
    try {
      uploadedPendingFile = Boolean(await saveDocumentToCloud(pending.file, pending.parsed)) || uploadedPendingFile;
    } catch (error) {
      storageStatus.textContent = `Could not save ${pending.file.name}: ${error.message}`;
    }
  }
  if (!uploadedPendingFile) return;
  try {
    await loadSavedDocuments();
  } catch (error) {
    storageStatus.textContent = `The upload completed, but the saved-document list could not refresh: ${error.message}`;
  }
}

function showSignedInUser(user) {
  localStorage.setItem("frontboard-user", JSON.stringify({
    name: user.name,
    email: user.email || ""
  }));
  appShell.hidden = false;
  signInFallback.hidden = true;
  document.querySelector("#google-sign-in").hidden = true;
  if (signedInUser) signedInUser.hidden = false;
  if (signedInName) signedInName.textContent = user.name;
  if (signedInAvatar) {
    signedInAvatar.textContent = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  }
  const footerName = document.querySelector(".sidebar-footer strong");
  const footerRole = document.querySelector(".sidebar-footer small");
  const avatar = document.querySelector(".sidebar-footer .avatar");
  if (footerName) footerName.textContent = user.name;
  if (footerRole) footerRole.textContent = user.email || "Travel desk";
  if (avatar) {
    avatar.textContent = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  }
}

const savedUser = (() => {
  try {
    return JSON.parse(localStorage.getItem("frontboard-user") || "null");
  } catch {
    return null;
  }
})();
if (savedUser?.name && savedUser.name !== "Google account") {
  showSignedInUser(savedUser);
  storageStatus.textContent = "Sign in with Google again to access your private documents.";
} else if (savedUser) {
  localStorage.removeItem("frontboard-user");
}

function initializeGoogleIdentity() {
  const config = window.FRONTBOARD_CONFIG;
  if (!config?.googleClientId) {
    signInFallback.hidden = false;
    storageStatus.textContent = "Google sign-in is not configured.";
    return;
  }
  if (!window.google?.accounts?.id) {
    storageStatus.textContent = "Google sign-in is still loading. Try again shortly.";
    return;
  }
  if (googleIdentityInitialized) return;

  window.google.accounts.id.initialize({
    client_id: config.googleClientId,
    callback: handleGoogleCredential
  });
  window.google.accounts.id.renderButton(document.querySelector("#google-sign-in"), {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 220
  });
  googleIdentityInitialized = true;
  signInFallback.hidden = true;
  storageStatus.textContent = "Google sign-in uses account identity only. Cloud storage access is requested when you upload.";
}

function requestGoogleIdentity() {
  initializeGoogleIdentity();
  if (window.google?.accounts?.id) {
    window.google.accounts.id.prompt();
  } else {
    storageStatus.textContent = "Google sign-in is still loading. Try again shortly.";
  }
}

storageConsentCheckbox.addEventListener("change", () => {
  storageConsentAccept.disabled = !storageConsentCheckbox.checked;
});

storageConsentAccept.addEventListener("click", () => {
  if (storageConsentCheckbox.checked) storageConsentDialog.close("accept");
});

storageConsentDecline.addEventListener("click", () => {
  storageConsentDialog.close("decline");
});

storageConsentDialog.addEventListener("close", () => {
  if (!storageConsentResolver) return;
  const resolve = storageConsentResolver;
  storageConsentResolver = null;
  resolve(storageConsentDialog.returnValue === "accept");
});

function promptForStorageConsent() {
  if (typeof storageConsentDialog.showModal !== "function") {
    return Promise.resolve(window.confirm(
      "FrontBoard will privately store this document and its extracted travel details under your Google account. You can delete saved documents at any time. Continue?",
    ));
  }

  storageConsentCheckbox.checked = false;
  storageConsentAccept.disabled = true;
  storageConsentDialog.returnValue = "";
  storageConsentDialog.showModal();
  return new Promise((resolve) => {
    storageConsentResolver = resolve;
  });
}

async function ensureStorageConsent() {
  const consent = await window.frontboardStorage.getConsent();
  if (consent.accepted && consent.version === "1") return true;
  if (!await promptForStorageConsent()) return false;
  await window.frontboardStorage.acceptConsent("1");
  return true;
}

async function saveDocumentToCloud(file, parsed) {
  if (!supabaseUser) throw new Error("Sign in with Google to store documents privately.");
  if (!await ensureStorageConsent()) {
    storageStatus.textContent = "Storage was declined. The document was parsed locally only.";
    return null;
  }

  const extractedRecords = parsed.map((record) => ({
    schema_version: "1.0",
    source_document: file.name,
    extracted_at: new Date().toISOString(),
    document: record.intelligence || runTravelIntelligence(file.name, "", [record])[0]?.intelligence || null,
    evidence: record.evidence || null,
    confidence: record.confidence || null,
    flags: record.flags || []
  }));
  const result = await window.frontboardStorage.uploadDocument(file, extractedRecords);
  parsed.forEach((ticket) => {
    ticket.documentId = result.document.id;
    ticket.sourceDocument = file.name;
  });
  storageStatus.textContent = `Saved privately to your FrontBoard storage (${extractedRecords.length} travel record${extractedRecords.length === 1 ? "" : "s"}).`;
  return result.document;
}

async function loadSavedDocuments() {
  if (!supabaseUser) return;
  const result = await window.frontboardStorage.listDocuments();
  cloudDocuments = result.documents;
  const storedTickets = [];
  let unrenderableRecords = 0;
  cloudDocuments.forEach((document) => {
    document.records.forEach((record) => {
      const ticket = travelJsonToTicket(record, document.id);
      if (ticket) storedTickets.push(ticket);
      else unrenderableRecords += 1;
    });
  });
  tickets = [...storedTickets, ...tickets.filter((ticket) => !ticket.documentId)];
  const historyCount = storedTickets.filter(isTravelHistory).length;
  const upcomingCount = storedTickets.length - historyCount;
  if (!upcomingCount && historyCount) setActiveView("Travel history");
  renderSavedDocuments();
  renderTickets();
  if (!cloudDocuments.length) {
    storageStatus.textContent = "No cloud documents saved yet. Your next upload will show the storage notice.";
  } else {
    const planSummary = `${upcomingCount} upcoming plan${upcomingCount === 1 ? "" : "s"} and ${historyCount} in Travel history`;
    const skippedSummary = unrenderableRecords
      ? ` ${unrenderableRecords} saved record${unrenderableRecords === 1 ? "" : "s"} could not be displayed.`
      : "";
    storageStatus.textContent = `Loaded ${cloudDocuments.length} saved document${cloudDocuments.length === 1 ? "" : "s"}: ${planSummary}.${skippedSummary}`;
  }
}

function downloadSavedDocument(document) {
  return window.frontboardStorage.downloadOriginal(document).then((blob) => {
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.source_document;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
}

async function deleteSavedDocument(document) {
  if (!window.confirm(`Permanently delete "${document.source_document}" and its travel JSON from your FrontBoard storage?`)) return;
  await window.frontboardStorage.deleteDocument(document);
  cloudDocuments = cloudDocuments.filter((saved) => saved.id !== document.id);
  tickets = tickets.filter((ticket) => ticket.documentId !== document.id);
  renderSavedDocuments();
  renderTickets();
  storageStatus.textContent = "The original document and its travel JSON were deleted.";
}

function travelJsonToTicket(json, documentId = null) {
  const document = json.document;
  if (!document) return null;
  const itinerary = document.itinerary?.[0] || {};
  const documentType = classifyDocumentType(document.document_type, json.evidence || document.evidence || "");
  const passengers = Array.isArray(document.passengers)
    ? document.passengers.filter((passenger) => passenger && typeof passenger === "object")
    : [];
  const confidence = json.confidence && typeof json.confidence === "object" && !Array.isArray(json.confidence)
    ? Object.fromEntries(Object.entries(json.confidence).filter(([, value]) => Number.isFinite(value)))
    : null;
  return {
    type: documentType === "flight" ? "Flight"
      : documentType === "train" ? "Train"
        : documentType === "hotel" ? "Hotel"
          : documentType === "bus" ? "Bus" : "Ticket",
    number: document.booking_reference || "Not provided",
    pnr: document.booking_reference || "Not provided",
    date: normalizeTravelDateRange(
      itinerary.departure_date || "Date not provided",
      json.evidence || document.evidence || ""
    ),
    time: itinerary.departure_time || "Time not provided",
    origin: itinerary.origin || "",
    destination: itinerary.destination || "",
    passenger: passengers.map((passenger) => passenger.name).join(", ") || "Passenger not provided",
    passengers,
    seat: passengers.map((passenger) => passenger.seat).filter(Boolean).join(", ") || "Not assigned",
    status: itinerary.status || "Confirmed",
    evidence: json.evidence || null,
    confidence,
    flags: Array.isArray(json.flags) ? json.flags.filter((flag) => typeof flag === "string") : [],
    intelligence: document,
    documentId,
    sourceDocument: json.source_document || ""
  };
}

async function processFiles(files) {
  if (!files.length) return;

  uploadStatus.textContent = `Reading ${files.length} document${files.length === 1 ? "" : "s"}...`;

  let parsedCount = 0;
  for (const file of files) {
    try {
      const text = await readDocument(file);
      const parsed = parseDocument(file.name, text);
      tickets.push(...parsed);
      parsedCount += parsed.length;
      addLoadedFile(file.name, parsed.length);
      if (parsed.length) {
        ticketSearch.value = "";
        setActiveView(parsed.every(isTravelHistory) ? "Travel history" : "All tickets");
      }
      if (supabaseUser) {
        try {
          const savedDocument = await saveDocumentToCloud(file, parsed);
          if (savedDocument) await loadSavedDocuments();
        } catch (error) {
          storageStatus.textContent = `Could not save ${file.name}: ${error.message}`;
        }
      } else if (savedUserIsSignedIn()) {
        pendingStorageUploads.push({ file, parsed });
        storageStatus.textContent = "Sign in with Google again to securely save this document.";
        requestGoogleIdentity();
      } else {
        storageStatus.textContent = "Parsed locally. Sign in with Google to save documents privately.";
      }
    } catch (error) {
      addLoadedFile(file.name, 0, error.message);
    }
  }

  fileCount.textContent = String(loadedFiles.children.length);
  clearTickets.disabled = tickets.length === 0;
  uploadStatus.textContent = parsedCount
    ? `${parsedCount} ticket${parsedCount === 1 ? "" : "s"} added to the board`
    : "No ticket details found. Try CSV, JSON, or TXT.";
  renderTickets();
}

async function readDocument(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "pdf") {
    if (!window.pdfjsLib) throw new Error("PDF reader could not load");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const bytes = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map();
      content.items.forEach((item) => {
        if (!item.str) return;
        const y = Math.round(item.transform[5]);
        const x = item.transform[4];
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x, text: item.str });
      });
      const pageText = [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "))
        .join("\n");
      pages.push(pageText);
    }
    return pages.join("\n");
  }
  return file.text();
}

function parseDocument(fileName, text) {
  const extension = fileName.split(".").pop().toLowerCase();

  if (extension === "json") {
    const data = JSON.parse(text);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data.tickets)
        ? data.tickets
        : Array.isArray(data.records)
          ? data.records
          : [data];
    return runTravelIntelligence(fileName, text, rows.map(normalizeTicket));
  }

  if (extension === "csv") {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const headers = rows.shift().map((header) => normalizeKey(header));
    const parsed = rows.filter((row) => row.some(Boolean)).map((row) => {
      const object = {};
      headers.forEach((header, index) => { object[header] = row[index]?.trim() || ""; });
      return normalizeTicket(object);
    }).filter((ticket) => ticket.passenger || ticket.number || ticket.origin);
    return runTravelIntelligence(fileName, text, parsed);
  }

  return runTravelIntelligence(fileName, text, parseTextFeed(text));
}

function runTravelIntelligence(fileName, evidenceText, parsedRecords) {
  return parsedRecords.map((record, index) => {
    const evidence = evidenceText.slice(0, 5000);
    const text = `${evidence}\n${Object.values(record).join(" ")}`;
    const documentType = classifyDocumentType(record.type, text);

    const normalized = documentType === "hotel"
      ? "Hotel"
      : documentType === "flight"
        ? "Flight"
        : documentType === "train"
          ? "Train"
          : documentType === "bus"
            ? "Bus"
            : "Ticket";

    const confidence = {
      document_type: documentType === "other" ? 0.2 : 0.88,
      booking_reference: record.number && record.number !== "Not provided" ? 0.9 : 0.1,
      itinerary: record.origin && record.destination ? 0.85 : 0.15,
      passengers: record.passengers?.length ? 0.95 : (record.passenger !== "Passenger not provided" ? 0.7 : 0.1),
      date: record.date && record.date !== "Date not provided" ? 0.85 : 0.1,
      time: record.time && record.time !== "Time not provided" ? 0.85 : 0.1
    };

    const flags = [];
    if (record.origin === "Origin not provided" || record.destination === "Destination not provided") {
      flags.push("Journey origin or destination is unavailable.");
    }
    if (!record.passengers?.length && (!record.passenger || record.passenger === "Passenger not provided")) {
      flags.push("No passenger details were found.");
    }
    if (record.date === "Date not provided") flags.push("Travel date was not found.");
    if (record.time === "Time not provided") flags.push("Travel time was not found.");

    const result = {
      document_type: normalized,
      document_name: fileName,
      booking_reference: record.number && record.number !== "Not provided" ? record.number : null,
      itinerary: [{
        origin: record.origin || null,
        destination: record.destination || null,
        departure_date: record.date === "Date not provided" ? null : record.date,
        departure_time: record.time === "Time not provided" ? null : record.time,
        status: record.status || null
      }],
      passengers: record.passengers?.length
        ? record.passengers.map((passenger) => ({
            name: passenger.name,
            gender: passenger.gender || null,
            age: passenger.age ? Number(passenger.age) : null,
            seat: passenger.seat || null
          }))
        : record.passenger && record.passenger !== "Passenger not provided"
          ? [{ name: record.passenger, gender: null, age: null, seat: record.seat || null }]
          : [],
      currency: null,
      total_amount: null,
      evidence: evidence.slice(0, 500),
      confidence,
      flags
    };

    return {
      ...record,
      type: normalized,
      evidence: result.evidence,
      confidence: confidence,
      flags: result.flags,
      intelligence: result
    };
  });
}

function classifyDocumentType(declaredType, evidenceText) {
  const declared = String(declaredType || "").trim().toLowerCase();
  const evidence = String(evidenceText || "");

  if (declared === "bus" || /\b(?:bus booking|bus ticket|boarding point|drop point|bus stand|bus operator|red\s?bus|non a\/c sleeper)\b/i.test(evidence)) {
    return "bus";
  }
  if (declared === "hotel" || /\b(?:hotel|reservation|check.?in|check.?out)\b/i.test(evidence)) {
    return "hotel";
  }
  if (declared === "train" || /\b(?:train|railway|rail ticket|irctc|platform\s*#?\s*\d+)\b/i.test(evidence)) {
    return "train";
  }
  if (declared === "flight" || /\b(?:flight|airline|airways|airport|boarding pass|flight emissions)\b/i.test(evidence)) {
    return "flight";
  }
  return "other";
}

function parseTextFeed(text) {
  const busTicket = parseBusTicketText(text);
  if (busTicket) return [busTicket];

  const flightTickets = parseFlightItineraryText(text);
  if (flightTickets) return flightTickets;

  const blocks = text
    .split(/\n\s*\n|(?=^(?:flight|bus|ticket)\s*[:#-])/im)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 1) {
    const lines = text.split(/\n|[|;]/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 1) return [normalizeTicket(parseKeyValueLines(lines))];
  }

  return blocks.map((block) => normalizeTicket(parseKeyValueLines(block.split(/\n|[|;]/))));
}

function parseFlightItineraryText(text) {
  if (!/\b(?:Turkish Airlines|Airlines|Flight\s+emissions|E-ticket|Departure\s+\d{1,2}\s+[A-Z][a-z]+\b)/i.test(text)) return null;

  const bookingReference = text.match(/Airline Booking Reference(?:s)?[\s\S]*?\b([A-Z]{6})\b/i)?.[1]
    || text.match(/Booking ref(?:erence)?:\s*([A-Z0-9]+)/i)?.[1]
    || null;
  const ticketNumbers = [...text.matchAll(/E-ticket\s+([A-Z0-9-]+)\s+for\s+(?:\(Infant\)\s*)?([A-Za-z][A-Za-z .'-]+)/gi)]
    .map((match) => ({ number: match[1].trim(), name: match[2].replace(/\s+/g, " ").trim() }));

  const passengers = [];
  const travellerText = text.match(/Traveler\s+([\s\S]*?)\nRengaraja Jeyabalan/);
  const travelerLine = text.match(/Traveler\s+([A-Z][A-Za-z .'-]+?)\s*\(/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (travelerLine) passengers.push({ name: travelerLine, gender: null, age: null, seat: null });
  const additionalTraveler = text.match(/(?:\n|\s)([A-Z][A-Z .'-]+Jeyabalan)\s*(?:\n|$)/)?.[1]?.trim();
  if (additionalTraveler && !passengers.some((passenger) => passenger.name === additionalTraveler)) {
    passengers.push({ name: additionalTraveler, gender: null, age: null, seat: null });
  }

  ticketNumbers.forEach((ticket) => {
    if (!passengers.some((passenger) => passenger.name.toLowerCase() === ticket.name.toLowerCase())) {
      passengers.push({ name: ticket.name, gender: null, age: null, seat: null });
    }
  });

  if (!passengers.length) {
    [...text.matchAll(/([A-Z][A-Za-z .'-]+)\s+(?:Scan for check-in)/g)].forEach((match) => {
      const name = match[1].trim();
      if (name && !passengers.some((passenger) => passenger.name === name)) {
        passengers.push({ name, gender: null, age: null, seat: null });
      }
    });
  }

  const flightMatches = [...text.matchAll(/(?:[A-Za-z]+\s+)?Air(?:ways|lines)\s+([A-Z]{2}\s*\d{1,4})/gi)];
  const segments = flightMatches.map((match, index) => {
    const blockStart = match.index;
    const blockEnd = flightMatches[index + 1]?.index || text.length;
    const block = text.slice(blockStart, blockEnd);
    const departure = block.match(/Departure\s+(\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?)\s+(\d{1,2}:\d{2}\s+(?:AM|PM))\s+([^\n]+)/i);
    const arrival = block.match(/Arrival\s+(\d{1,2}\s+[A-Z][a-z]+(?:\s+\d{4})?)\s+(\d{1,2}:\d{2}\s+(?:AM|PM))\s+([^\n]+)/i);
    if (!departure || !arrival) return null;
    const originAirport = departure[3].match(/\(([^)]+)\)/)?.[1] || departure[3].replace(/^[^,]+,\s*/, "").trim();
    const destinationAirport = arrival[3].match(/\(([^)]+)\)/)?.[1] || arrival[3].replace(/^[^,]+,\s*/, "").trim();
    const originCity = departure[3].match(/^([^,(]+)/)?.[1]?.replace(/\s+/g, " ").trim() || null;
    const destinationCity = arrival[3].match(/^([^,(]+)/)?.[1]?.replace(/\s+/g, " ").trim() || null;
    const status = block.match(/Booking status\s+(Confirmed|Cancelled|Unconfirmed)/i)?.[1] || "Confirmed";
    return {
      number: match[1].replace(/\s+/g, ""),
      departureDate: departure[1],
      departureTime: departure[2].replace(/\s+/g, " ").toUpperCase(),
      origin: originAirport,
      originLocation: originCity,
      arrivalDate: arrival[1],
      arrivalTime: arrival[2].replace(/\s+/g, " ").toUpperCase(),
      destination: destinationAirport,
      destinationLocation: destinationCity,
      status
    };
  }).filter(Boolean);

  if (!segments.length) return null;

  return segments.map((segment) => {
    const departureDate = normalizeTravelDate(segment.departureDate, text);
    const arrivalDate = normalizeTravelDate(segment.arrivalDate, text);
    const passengerNames = passengers.map((passenger) => passenger.name);
    return {
      type: "Flight",
      number: segment.number,
      pnr: bookingReference,
      date: `${departureDate}${arrivalDate !== departureDate ? ` → ${arrivalDate}` : ""}`,
      time: `${segment.departureTime} → ${segment.arrivalTime}`,
      origin: segment.originLocation || segment.origin,
      originCode: segment.origin,
      destination: segment.destinationLocation || segment.destination,
      destinationCode: segment.destination,
      passenger: passengerNames.join(", ") || "Passenger not provided",
      passengers,
      seat: "Not assigned",
      status: segment.status,
      tickets: ticketNumbers
    };
  });
}

function normalizeTravelDate(value, evidenceText) {
  const match = String(value).match(/(\d{1,2})\s+([A-Z][a-z]+)(?:\s+(\d{4}))?/);
  if (!match) return String(value);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthIndex = months.indexOf(match[2].slice(0, 3).toLowerCase());
  if (monthIndex < 0) return String(value);
  let year = match[3];
  if (!year && evidenceText) {
    const exactDate = evidenceText.match(new RegExp(`${match[1]}\\s+${match[2]}\\s+(\\d{4})`, "i"));
    year = exactDate?.[1];
  }
  if (!year) year = new Date().getFullYear();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeTravelDateRange(value, evidenceText) {
  const dates = String(value || "Date not provided").split(/\s*(?:→|->)\s*/);
  const normalized = dates.map((date) => normalizeTravelDate(date, evidenceText));
  if (normalized.length > 1 && !/\b\d{4}\b/.test(dates[1])) {
    const departure = getTravelDateParts(normalized[0]);
    const arrival = getTravelDateParts(normalized[1]);
    if (departure && arrival && arrival.year === departure.year
      && (arrival.month < departure.month || (arrival.month === departure.month && arrival.day < departure.day))) {
      normalized[1] = normalized[1].replace(/^\d{4}/, String(departure.year + 1));
    }
  }
  return normalized.join(" → ");
}

function parseBusTicketText(text) {
  if (!/\b(?:bus booking|bus ticket|e-ticket|ticket id)\b/i.test(text)) return null;

  const ticketId = text.match(/Ticket\s*ID:\s*([A-Z0-9]+)/i)?.[1];
  const pnrMatch = text.match(/PNR\s*:?\s*([A-Z0-9]+)/i);
  const pnr = pnrMatch?.[1];
  const orderNumber = text.match(/Order\s*#\s*([0-9-]+)/i)?.[1];

  const lines = text.split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);
  let origin = "";
  let destination = "";

  if (pnrMatch) {
    const pnrIndex = lines.findIndex((line) => line.toUpperCase().includes(pnr));
    if (pnrIndex >= 0) {
      const routeLineCandidates = lines.slice(pnrIndex + 1).filter((line) =>
        !/^(?:PNR|TICKET|ALAYA|NON A\/C|BOARDING|DROP|[A-Z]+ ROAD)/i.test(line)
        && !/^(?:Point|Date|Time|Duration|Male|Female|Traveller)/i.test(line)
      );
      const cities = routeLineCandidates.slice(0, 4);
      if (cities.length >= 2) {
        origin = cities[0].replace(/^\d[\d:.]*\s*/, "").trim();
        destination = cities[1].replace(/^\d[\d:.]*\s*/, "").trim();
      }
    }
  }

  if (!origin || !destination) {
    const routeMatch = text.match(/(?:PNR\s*:?\s*[A-Z0-9]+[\s\S]{0,180}?)([A-Z][A-Za-z\s.'-]{2,35}?)\s+(?:([A-Z][A-Za-z\s.'-]{2,35}?))\s+(?:[A-Z][A-Z\s]*(?:LINES|TRAVELS|BUS))/i);
    origin = origin || routeMatch?.[1]?.trim() || "";
    destination = destination || routeMatch?.[2]?.trim() || "";
  }

  const times = [...text.matchAll(/(?:\b|[^\d])(\d{1,2}:\d{2}\s*(?:AM|PM))/gi)].map((match) => match[1].replace(/\s+/g, " ").toUpperCase());
  const dates = [...text.matchAll(/\b((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\b/gi)].map((match) => match[1]);
  const boardingDate = dates[0] ? normalizeTravelDate(dates[0], text) : "Date not provided";
  const arrivalDate = dates[1] ? normalizeTravelDate(dates[1], text) : "";
  const dateDisplay = arrivalDate ? `${boardingDate} → ${arrivalDate}` : boardingDate;

  const passengers = [];
  const travellerStart = text.search(/Traveller Details|Travellers\s+Gender/i);
  const travellerText = travellerStart >= 0 ? text.slice(travellerStart) : text;

  const travellerLines = travellerText.split(/\r?\n| {2,}/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < travellerLines.length - 2; index += 1) {
    const genderMatch = travellerLines[index + 1].match(/^(Female|Male),\s*(\d+)\s*years?/i);
    if (!genderMatch) continue;
    const name = travellerLines[index].replace(/^(?:Travellers?|Gender.*|Seat.*)$/i, "").trim();
    const seat = travellerLines[index + 2].match(/^([A-Z0-9]+)/)?.[1];
    if (name && !/^(?:Traveller Details|Gender|Age|Seat)/i.test(name) && seat) {
      passengers.push({ name, gender: genderMatch[1], age: genderMatch[2], seat });
      index += 2;
    }
  }

  if (!passengers.length) {
    const travellerPattern = /([A-Z][A-Za-z.-]*(?:[ \t]+[A-Z][A-Za-z.-]*){0,3})\s+(Female|Male),\s*(\d+)\s*years?\s+([A-Z0-9]+)/gi;
    let travellerMatch;
    while ((travellerMatch = travellerPattern.exec(travellerText)) !== null) {
      passengers.push({
        name: travellerMatch[1].trim(),
        gender: travellerMatch[2],
        age: travellerMatch[3],
        seat: travellerMatch[4]
      });
    }
  }

  if (!ticketId && !pnr && !passengers.length && !origin) return null;

  return {
    type: "Bus",
    number: ticketId || pnr || orderNumber || "Not provided",
    pnr: pnr || "Not provided",
    date: dateDisplay,
    time: times.length ? `${times[0]} → ${times.find((time, index) => index > 0) || "Arrival not provided"}` : "Time not provided",
    origin: origin || "Origin not provided",
    destination: destination || "Destination not provided",
    passenger: passengers.map((passenger) => passenger.name).join(", ") || "Passenger not provided",
    passengers,
    seat: passengers.map((passenger) => passenger.seat).join(", ") || "Not assigned",
    status: "Confirmed"
  };
}

function parseKeyValueLines(lines) {
  const result = {};
  lines.forEach((line) => {
    const match = line.match(/([^:=-]+?)\s*[:=-]\s*(.+)$/);
    if (match) result[normalizeKey(match[1])] = match[2].trim();
  });
  const text = lines.join(" ");
  if (!result.type) {
    result.type = /\bflight\b/i.test(text) ? "Flight" : /\bbus\b/i.test(text) ? "Bus" : "Ticket";
  }
  return result;
}

function normalizeTicket(input) {
  const record = Object.keys(input).reduce((output, key) => {
    output[normalizeKey(key)] = input[key];
    return output;
  }, {});

  const first = (...keys) => keys.map((key) => record[key]).find((value) => value !== undefined && value !== null && String(value).trim());
  const text = Object.values(record).join(" ");
  const type = String(first("type", "transport", "mode") || (/\bflight\b/i.test(text) ? "Flight" : /\bbus\b/i.test(text) ? "Bus" : "Ticket"));

  const normalizedType = type.trim().toLowerCase();
  return {
    type: normalizedType.includes("flight") ? "Flight" : normalizedType === "bus" ? "Bus" : type,
    number: String(first("number", "ticketnumber", "ticket_no", "ticket", "flightnumber", "flight", "busnumber", "route") || "Not provided"),
    date: String(first("date", "traveldate", "departuredate", "journeydate") || "Date not provided"),
    time: String(first("time", "departuretime", "boardtime", "departure") || "Time not provided"),
    origin: String(first("origin", "from", "departure", "source") || ""),
    destination: String(first("destination", "to", "arrival", "terminal") || ""),
    passenger: String(first("passenger", "passengername", "name", "traveler") || "Passenger not provided"),
    passengers: Array.isArray(record.passengers) ? record.passengers : [],
    seat: String(first("seat", "seatnumber", "berth") || "Not assigned"),
    status: String(first("status", "bookingstatus") || "Confirmed")
  };
}

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function addLoadedFile(name, ticketCount, errorMessage) {
  const row = document.createElement("div");
  row.className = "loaded-file";
  row.innerHTML = `<span class="file-badge">DOC</span><div><strong></strong><small></small></div>`;
  row.querySelector("strong").textContent = name;
  row.querySelector("small").textContent = errorMessage || `${ticketCount} ticket${ticketCount === 1 ? "" : "s"} found`;
  if (errorMessage) row.classList.add("error");
  loadedFiles.append(row);
}

function renderSavedDocuments() {
  savedDocumentCount.textContent = String(cloudDocuments.length);
  savedDocumentsElement.replaceChildren();

  if (!supabaseUser) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "saved-documents-empty";
    emptyMessage.textContent = savedUserIsSignedIn()
      ? "Sign in again to view your saved documents."
      : "Sign in to view your saved documents.";
    savedDocumentsElement.append(emptyMessage);
    return;
  }

  if (!cloudDocuments.length) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "saved-documents-empty";
    emptyMessage.textContent = "No documents saved yet.";
    savedDocumentsElement.append(emptyMessage);
    return;
  }

  cloudDocuments.forEach((savedDocument) => {
    const row = document.createElement("div");
    row.className = "loaded-file saved-file";

    const badge = document.createElement("span");
    badge.className = "file-badge";
    badge.textContent = String(savedDocument.fileExtension || "doc").toUpperCase();

    const details = document.createElement("div");
    const filename = document.createElement("strong");
    filename.textContent = savedDocument.source_document;
    const metadata = document.createElement("small");
    const uploadedDate = new Date(savedDocument.uploadedAt);
    const dateLabel = Number.isNaN(uploadedDate.getTime())
      ? "Saved to private storage"
      : `Saved ${uploadedDate.toLocaleDateString()}`;
    metadata.textContent = `${dateLabel} · ${savedDocument.recordCount} travel record${savedDocument.recordCount === 1 ? "" : "s"}`;
    details.append(filename, metadata);

    const actions = document.createElement("div");
    actions.className = "saved-file-actions";
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.textContent = "Download";
    downloadButton.setAttribute("aria-label", `Download ${savedDocument.source_document}`);
    downloadButton.addEventListener("click", () => {
      downloadSavedDocument(savedDocument).catch((error) => {
        storageStatus.textContent = `Could not download ${savedDocument.source_document}: ${error.message}`;
      });
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-file-delete";
    deleteButton.textContent = "Delete";
    deleteButton.setAttribute("aria-label", `Delete ${savedDocument.source_document}`);
    deleteButton.addEventListener("click", () => {
      deleteSavedDocument(savedDocument).catch((error) => {
        storageStatus.textContent = `Could not delete ${savedDocument.source_document}: ${error.message}`;
      });
    });

    actions.append(downloadButton, deleteButton);
    row.append(badge, details, actions);
    savedDocumentsElement.append(row);
  });
}

function renderTickets() {
  const search = ticketSearch.value.trim().toLowerCase();
  const visible = tickets.filter((ticket) => {
    const isHistory = isTravelHistory(ticket);
    const matchesFilter = activeFilter === "Travel history"
      ? isHistory
      : !isHistory && (activeFilter === "All tickets" || ticket.type === activeFilter);
    const matchesSearch = !search || Object.values(ticket).join(" ").toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  const upcomingTickets = tickets.filter((ticket) => !isTravelHistory(ticket));
  const flights = upcomingTickets.filter((ticket) => ticket.type === "Flight").length;
  const buses = upcomingTickets.filter((ticket) => ticket.type === "Bus").length;
  const passengerNames = new Set();
  upcomingTickets.forEach((ticket) => {
    if (ticket.passengers?.length) {
      ticket.passengers.forEach((passenger) => passengerNames.add(passenger.name));
    } else if (ticket.passenger && ticket.passenger !== "Passenger not provided") {
      passengerNames.add(ticket.passenger);
    }
  });
  const passengers = passengerNames.size;

  document.querySelector("#flight-count").textContent = String(flights);
  document.querySelector("#bus-count").textContent = String(buses);
  document.querySelector("#passenger-count").textContent = String(passengers);

  if (!visible.length) {
    const historyCount = tickets.filter(isTravelHistory).length;
    const message = activeFilter === "Travel history"
      ? "No travel history yet"
      : upcomingTickets.length ? "No matching tickets" : "No upcoming tickets";
    const detail = activeFilter === "Travel history"
      ? "Trips move here after their travel month has passed."
      : upcomingTickets.length
        ? "Try a different search or ticket filter."
        : historyCount
          ? "Past trips are in Travel history."
          : "Upload a CSV, JSON, text, or PDF document to populate this board.";
    ticketList.innerHTML = `<article class="empty-state"><span class="empty-icon">${activeFilter === "Travel history" ? "◷" : upcomingTickets.length ? "⌕" : "⇧"}</span><h2>${message}</h2><p>${detail}</p></article>`;
    return;
  }

  ticketList.innerHTML = visible.map((ticket, index) => {
    const typeLabel = String(ticket.type || "Ticket");
    const typeClass = ["flight", "bus", "hotel", "train"].includes(typeLabel.toLowerCase())
      ? typeLabel.toLowerCase()
      : "ticket";
    const icon = typeClass === "flight" ? "✈" : typeClass === "bus" ? "▰" : "▦";
    const route = ticket.origin || ticket.destination
      ? `${escapeHtml(ticket.origin || "Origin")} <span class="route-arrow">→</span> ${escapeHtml(ticket.destination || "Destination")}`
      : "Route not provided";
    const passengerDetails = ticket.passengers?.length
      ? ticket.passengers.map((passenger) =>
          `<div class="passenger-row"><strong>${escapeHtml(passenger.name)}</strong><span>${escapeHtml(passenger.gender)}, ${escapeHtml(passenger.age)} years · Seat ${escapeHtml(passenger.seat)}</span></div>`
        ).join("")
      : `<div><small>Passenger</small><strong>${escapeHtml(ticket.passenger)}</strong></div>
         <div><small>Seat</small><strong>${escapeHtml(ticket.seat)}</strong></div>`;
    const confidenceValues = Object.values(ticket.confidence || {}).filter(Number.isFinite);
    const averageConfidence = confidenceValues.length
      ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length * 100)
      : null;
    const reviewBadge = ticket.flags?.length
      ? `<span class="ticket-status review-status">Review · ${escapeHtml(ticket.flags.length)}</span>`
      : "";
    const confidenceBadge = averageConfidence !== null
      ? `<span class="confidence-badge">${averageConfidence}% confidence</span>`
      : "";
    const reviewDetails = ticket.flags?.length
      ? `<div class="review-details"><small>Extraction flags</small>${ticket.flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}</div>`
      : "";
    return `<article class="ticket-card">
      <div class="ticket-rail ${typeClass}"></div>
      <div class="ticket-main">
        <div class="ticket-heading">
          <span class="ticket-type ${typeClass}">${icon} ${escapeHtml(typeLabel)}</span>
          <span class="ticket-status">${escapeHtml(ticket.status)}</span>
          ${reviewBadge}
          ${confidenceBadge}
        </div>
        <div class="ticket-route">${route}</div>
        <div class="ticket-number">${escapeHtml(ticket.number)}</div>
      </div>
      <div class="ticket-details">
        <div><small>Date</small><strong>${escapeHtml(ticket.date)}</strong></div>
        <div><small>Time</small><strong>${escapeHtml(ticket.time)}</strong></div>
        <div class="travellers"><small>Travellers</small>${passengerDetails}</div>
        ${reviewDetails}
      </div>
    </article>`;
  }).join("");
}

function isTravelHistory(ticket, now = new Date()) {
  const tripDate = getTravelDateParts(ticket.date);
  if (!tripDate) return false;

  const currentParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const currentYear = Number(currentParts.find((part) => part.type === "year")?.value);
  const currentMonth = Number(currentParts.find((part) => part.type === "month")?.value);
  return tripDate.year * 12 + tripDate.month < currentYear * 12 + currentMonth;
}

function getTravelDateParts(value) {
  const date = String(value || "").split(/\s*(?:→|->)\s*/)[0].trim();
  let match = date.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (match) {
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  }

  match = date.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    let month = Number(match[1]);
    let day = Number(match[2]);
    if (month > 12 && day <= 12) [month, day] = [day, month];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day };
  }

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  match = date.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})(?:,?\s+(\d{4}))?\b/)
    || date.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/);
  if (!match) return null;

  const dayFirst = /^\d/.test(match[1]);
  const monthName = dayFirst ? match[2] : match[1];
  const month = months.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  const day = Number(dayFirst ? match[1] : match[2]);
  if (day < 1 || day > 31) return null;
  return { year: Number(match[3]) || new Date().getFullYear(), month, day };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
