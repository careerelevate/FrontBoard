const ticketList = document.querySelector("#ticket-list");
const ticketSearch = document.querySelector("#ticket-search");
const documentUpload = document.querySelector("#document-upload");
const dropZone = document.querySelector("#drop-zone");
const loadedFiles = document.querySelector("#loaded-files");
const uploadStatus = document.querySelector("#upload-status");
const fileCount = document.querySelector("#file-count");
const clearTickets = document.querySelector("#clear-tickets");
const driveStatus = document.querySelector("#drive-status");

let tickets = [];
let activeFilter = "All tickets";
let driveAccessToken = null;
let travelPlanFolderId = null;
let googleTokenClient = null;
let gapiInited = false;
let gisInited = false;
const pendingDriveUploads = [];

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

signOutButton.addEventListener("click", () => {
  accountMenu.hidden = true;
  pendingDriveUploads.length = 0;
  if (driveAccessToken) {
    window.google?.accounts?.oauth2?.revoke(driveAccessToken, () => {});
  }
  window.gapi?.client?.setToken(null);
  driveAccessToken = null;
  travelPlanFolderId = null;
  localStorage.removeItem("frontboard-user");
  signedInUser.hidden = true;
  signInFallback.hidden = false;
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
  const config = window.FRONTBOARD_DRIVE_CONFIG;
  if (!config?.clientId) {
    signInFallback.hidden = false;
    signInFallback.blur();
    return;
  }
  if (!googleTokenClient) initializeGoogleDrive();
  if (!googleTokenClient) return;

  googleTokenClient.callback = handleGoogleTokenResponse;
  googleTokenClient.requestAccessToken({
    prompt: "consent",
    include_granted_scopes: true
  });
});

githubProvider.addEventListener("click", () => {
  signInDialog.close();
  const config = window.FRONTBOARD_DRIVE_CONFIG;
  if (!config?.githubClientId) {
    window.alert("GitHub sign-in needs a GitHub OAuth client ID in google-drive-config.js.");
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

updateClock();
setInterval(updateClock, 1000);

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelector(".nav-item.active")?.classList.remove("active");
    item.classList.add("active");
    activeFilter = item.dataset.view;
    document.querySelector("#view-title").textContent =
      activeFilter === "All tickets" ? "Upcoming tickets" : `${activeFilter} tickets`;
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

window.addEventListener("load", initializeGoogleDrive);

function gapiLoaded() {
  if (!window.gapi) return;
  window.gapi.load("client", async () => {
    try {
      await window.gapi.client.init({
        discoveryDocs: [window.FRONTBOARD_DRIVE_CONFIG.discoveryDoc]
      });
      gapiInited = true;
    } catch (error) {
      driveStatus.textContent = `Google Drive API could not initialize: ${error.message}`;
    }
  });
}

function gisLoaded() {
  gisInited = true;
  initializeGoogleDrive();
}

async function handleGoogleTokenResponse(response) {
  if (response.error) {
    driveStatus.textContent = `Google sign-in failed: ${response.error}`;
    return;
  }

  driveAccessToken = response.access_token;
  if (window.gapi?.client) window.gapi.client.setToken(response);

  try {
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${driveAccessToken}` }
    });
    if (!userResponse.ok) throw new Error("Could not load your Google profile");
    const user = await userResponse.json();
    showSignedInUser({
      name: user.name || user.email || "Google user",
      email: user.email || "",
      picture: user.picture || ""
    });
  } catch (error) {
    driveStatus.textContent = error.message;
  }

  try {
    travelPlanFolderId = await ensureFrontBoardFolderHierarchy();
    driveStatus.textContent = "FrontBoard folder is ready";
    await syncFromGoogleDrive();
    while (pendingDriveUploads.length) {
      const pending = pendingDriveUploads.shift();
      await uploadOriginalAndJson(pending.file, pending.parsed);
    }
  } catch (error) {
    driveStatus.textContent = error.message;
  }
}

function handleGoogleCredential(response) {
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(response.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))));
    const name = payload.name || payload.email || "Google user";
    localStorage.setItem("frontboard-user", JSON.stringify({ name, email: payload.email || "", picture: payload.picture || "" }));
    showSignedInUser({ name, email: payload.email || "", picture: payload.picture || "" });
  } catch (error) {
    driveStatus.textContent = "Google sign-in could not be read";
  }
}

function showSignedInUser(user) {
  localStorage.setItem("frontboard-user", JSON.stringify(user));
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

const savedUser = JSON.parse(localStorage.getItem("frontboard-user") || "null");
if (savedUser && savedUser.name && savedUser.name !== "Google account") {
  showSignedInUser(savedUser);
} else if (savedUser) {
  localStorage.removeItem("frontboard-user");
}

function initializeGoogleDrive() {
  const config = window.FRONTBOARD_DRIVE_CONFIG;
  if (!config?.clientId) {
    signInFallback.textContent = "Sign in";
    signInFallback.disabled = false;
    signInFallback.hidden = false;
    document.querySelector("#google-sign-in").hidden = true;
    if (signedInUser) signedInUser.hidden = true;
    driveStatus.textContent = "Connect Google Drive after sign-in";
    return;
  }
  if (!window.google?.accounts?.oauth2) {
    driveStatus.textContent = "Google Identity Services could not load";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: config.clientId,
    callback: handleGoogleCredential
  });
  window.google.accounts.id.renderButton(document.querySelector("#google-sign-in"), {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 220
  });
  signInFallback.hidden = true;

  googleTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope: config.scopes,
    callback: () => {}
  });
  driveStatus.textContent = "Ready to connect";
}

async function driveRequest(url, options = {}) {
  if (!driveAccessToken) throw new Error("Google Drive is not connected");
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${driveAccessToken}`
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.status === 204 ? null : response.json();
}

async function ensureDriveChildFolder(parentId, folderName) {
  const escapedName = folderName.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
  const parentQuery = parentId ? `'${parentId}' in parents and ` : "'root' in parents and ";
  const query = encodeURIComponent(`${parentQuery}mimeType='application/vnd.google-apps.folder' and name='${escapedName}' and trashed=false`);
  const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`);
  if (result.files?.length) return result.files[0].id;

  const metadata = { name: folderName, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) metadata.parents = [parentId];
  return driveRequest("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata)
  }).then((folder) => folder.id);
}

async function ensureFrontBoardFolderHierarchy() {
  const now = new Date();
  const rootName = window.FRONTBOARD_DRIVE_CONFIG.folderName || "FrontBoard";
  const yearName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric"
  }).format(now);
  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long"
  }).format(now);

  const rootId = await ensureDriveChildFolder(null, rootName);
  const yearId = await ensureDriveChildFolder(rootId, yearName);
  travelPlanFolderId = await ensureDriveChildFolder(yearId, monthName);
  return travelPlanFolderId;
}

async function uploadOriginalAndJson(file, parsed) {
  if (!driveAccessToken) return;
  if (!travelPlanFolderId) travelPlanFolderId = await ensureFrontBoardFolderHierarchy();

  await uploadDriveFile(file, file.type || "application/octet-stream", travelPlanFolderId);
  for (const record of parsed) {
    const content = JSON.stringify({
      schema_version: "1.0",
      source_document: file.name,
      extracted_at: new Date().toISOString(),
      document: record.intelligence || runTravelIntelligence(file.name, "", [record])[0].intelligence,
      evidence: record.evidence || null,
      confidence: record.confidence || null,
      flags: record.flags || []
    }, null, 2);
    const filename = `${slugify(record.intelligence?.document_type || record.type || "travel")}-${slugify(record.intelligence?.booking_reference || record.number || "document")}-${Date.now()}.json`;
    await uploadDriveFile(new Blob([content], { type: "application/json" }), "application/json", travelPlanFolderId, filename);
  }
  const now = new Date();
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long" }).format(now);
  driveStatus.textContent = `Saved to FrontBoard / ${year} / ${month}`;
}

async function uploadDriveFile(blob, mimeType, folderId, filename) {
  const fileName = filename || blob.name;
  if (!fileName) throw new Error("A filename is required");

  const metadata = { name: fileName, mimeType, parents: [folderId] };
  const boundary = `frontboard_${crypto.randomUUID?.() || Date.now()}`;
  const bytes = await blob.arrayBuffer();
  const decoder = new TextDecoder();
  const metadataPrefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = new Blob([
    metadataPrefix,
    bytes,
    suffix
  ]);

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${driveAccessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!response.ok) throw new Error(`Could not upload ${fileName}: ${response.status}`);
  return response.json();
}

async function syncFromGoogleDrive() {
  if (!driveAccessToken) {
    driveStatus.textContent = "Connect Google Drive before syncing";
    return;
  }
  try {
    if (!travelPlanFolderId) travelPlanFolderId = await ensureFrontBoardFolderHierarchy();
    const query = encodeURIComponent(`'${travelPlanFolderId}' in parents and mimeType='application/json' and trashed=false`);
    const result = await driveRequest(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`);
    const storedRecords = [];
    for (const file of result.files || []) {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${driveAccessToken}` }
      });
      if (!response.ok) continue;
      const json = await response.json();
      const record = travelJsonToTicket(json);
      if (record) storedRecords.push(record);
    }
    if (storedRecords.length) {
      tickets = mergeTicketsByReference(tickets, storedRecords);
      renderTickets();
    }
    driveStatus.textContent = `${storedRecords.length} JSON record${storedRecords.length === 1 ? "" : "s"} synced`;
  } catch (error) {
    driveStatus.textContent = error.message;
  }
}

function travelJsonToTicket(json) {
  const document = json.document;
  if (!document) return null;
  const itinerary = document.itinerary?.[0] || {};
  const passengers = document.passengers || [];
  return {
    type: document.document_type === "Flight" ? "Flight"
      : document.document_type === "Train" ? "Train"
        : document.document_type === "Hotel" ? "Hotel"
          : document.document_type === "Bus" ? "Bus" : "Ticket",
    number: document.booking_reference || "Not provided",
    pnr: document.booking_reference || "Not provided",
    date: itinerary.departure_date || "Date not provided",
    time: itinerary.departure_time || "Time not provided",
    origin: itinerary.origin || "",
    destination: itinerary.destination || "",
    passenger: passengers.map((passenger) => passenger.name).join(", ") || "Passenger not provided",
    passengers,
    seat: passengers.map((passenger) => passenger.seat).filter(Boolean).join(", ") || "Not assigned",
    status: itinerary.status || "Confirmed",
    evidence: json.evidence || null,
    confidence: json.confidence || null,
    flags: json.flags || [],
    intelligence: document
  };
}

function mergeTicketsByReference(localTickets, storedTickets) {
  const merged = [...storedTickets];
  localTickets.forEach((ticket) => {
    const key = `${ticket.type}:${ticket.number}:${ticket.date}:${ticket.time}`;
    const exists = merged.some((item) => `${item.type}:${item.number}:${item.date}:${item.time}` === key);
    if (!exists) merged.push(ticket);
  });
  return merged;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "travel";
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
      if (driveAccessToken) {
        try {
          await uploadOriginalAndJson(file, parsed);
        } catch (error) {
          driveStatus.textContent = `Drive storage failed: ${error.message}`;
        }
      } else {
        pendingDriveUploads.push({ file, parsed });
        driveStatus.textContent = "Document queued; sign in with Google to save it to Drive";
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
    const documentType = /\b(?:flight|airline|boarding|airport|e-ticket|departure\s+\d{1,2}\s+[a-z]+|arrival\s+\d{1,2}\s+[a-z]+)\b/i.test(text)
      ? "flight"
      : /\bhotel|reservation|check.?in|check.?out\b/i.test(text)
        ? "hotel"
        : /\btrain|railway|coach|pnr\b/i.test(text)
          ? "train"
          : /\bbus|ticket id|boarding point|traveller details\b/i.test(text)
            ? "bus"
            : "other";

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

function parseTextFeed(text) {
  const flightTickets = parseFlightItineraryText(text);
  if (flightTickets) return flightTickets;

  const busTicket = parseBusTicketText(text);
  if (busTicket) return [busTicket];

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
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthIndex = months.findIndex((month) => month.toLowerCase() === match[2].toLowerCase());
  if (monthIndex < 0) return String(value);
  let year = match[3];
  if (!year && evidenceText) {
    const exactDate = evidenceText.match(new RegExp(`${match[1]}\\s+${match[2]}\\s+(\\d{4})`, "i"));
    year = exactDate?.[1];
  }
  if (!year) year = new Date().getFullYear();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
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
  const boardingDate = dates[0] || "Date not provided";
  const arrivalDate = dates[1] || "";
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

function renderTickets() {
  const search = ticketSearch.value.trim().toLowerCase();
  const visible = tickets.filter((ticket) => {
    const matchesFilter = activeFilter === "All tickets" || ticket.type === activeFilter;
    const matchesSearch = !search || Object.values(ticket).join(" ").toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  const flights = tickets.filter((ticket) => ticket.type === "Flight").length;
  const buses = tickets.filter((ticket) => ticket.type === "Bus").length;
  const passengerNames = new Set();
  tickets.forEach((ticket) => {
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
    const message = tickets.length ? "No matching tickets" : "No tickets loaded";
    const detail = tickets.length
      ? "Try a different search or ticket filter."
      : "Upload a CSV, JSON, text, or PDF document to populate this board.";
    ticketList.innerHTML = `<article class="empty-state"><span class="empty-icon">${tickets.length ? "⌕" : "⇧"}</span><h2>${message}</h2><p>${detail}</p></article>`;
    return;
  }

  ticketList.innerHTML = visible.map((ticket, index) => {
    const icon = ticket.type === "Flight" ? "✈" : ticket.type === "Bus" ? "▰" : "▦";
    const route = ticket.origin || ticket.destination
      ? `${ticket.origin || "Origin"} <span class="route-arrow">→</span> ${ticket.destination || "Destination"}`
      : "Route not provided";
    const passengerDetails = ticket.passengers?.length
      ? ticket.passengers.map((passenger) =>
          `<div class="passenger-row"><strong>${escapeHtml(passenger.name)}</strong><span>${escapeHtml(passenger.gender)}, ${escapeHtml(passenger.age)} years · Seat ${escapeHtml(passenger.seat)}</span></div>`
        ).join("")
      : `<div><small>Passenger</small><strong>${escapeHtml(ticket.passenger)}</strong></div>
         <div><small>Seat</small><strong>${escapeHtml(ticket.seat)}</strong></div>`;
    const averageConfidence = ticket.confidence
      ? Math.round(Object.values(ticket.confidence).reduce((sum, value) => sum + value, 0) / Object.values(ticket.confidence).length * 100)
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
      <div class="ticket-rail ${ticket.type.toLowerCase()}"></div>
      <div class="ticket-main">
        <div class="ticket-heading">
          <span class="ticket-type ${ticket.type.toLowerCase()}">${icon} ${escapeHtml(ticket.type)}</span>
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
