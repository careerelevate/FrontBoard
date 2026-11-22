# FrontBoard
A responsive travel-ticket board built with HTML, CSS, and JavaScript.

This repository captures planned travel and scheduling information.

## Run locally

Open `index.html` in a browser, or start a local server:

```powershell
npx serve .
```

## Features

- Eastern Time clock
- Drag-and-drop CSV, JSON, TXT, or PDF ticket documents
- Flight and bus ticket cards
- Passenger, date, time, route, and seat details
- Search and ticket-type filtering
- Local Travel Document Intelligence Agent
- Confidence scores and extraction review flags
- Layout-aware flight itinerary extraction
- Google Drive storage in a `Travel Plan` folder
- Original documents plus normalized JSON records in Drive
- Sync extracted JSON records back into the UI
- Google account sign-in

## Google Drive setup

1. Create an OAuth 2.0 Web application client in Google Cloud Console.
2. Add `https://careerelevate.github.io` as an authorized JavaScript origin.
3. Set the client ID in `google-drive-config.js`:

```javascript
window.FRONTBOARD_DRIVE_CONFIG = {
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  folderName: "Travel Plan",
  scopes: "https://www.googleapis.com/auth/drive.file"
};
```

After connecting Google Drive, FrontBoard creates or finds `Travel Plan`, uploads each original document, creates a normalized JSON record for each extracted ticket, and can sync those JSON records back into the board.
