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
- Google Drive storage in `FrontBoard/<year>/<month>` folders
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
  githubClientId: "YOUR_GITHUB_OAUTH_CLIENT_ID",
  folderName: "FrontBoard",
  scopes: "openid email profile https://www.googleapis.com/auth/drive"
};
```

After Google sign-in, FrontBoard creates or finds `FrontBoard`, then creates or finds the current year and month folders. It uploads the original document and a normalized JSON record directly inside the current month folder.

The top-right **Sign in** button opens Google Identity Services after `clientId` is configured.

Use `apis.google.com/js/api.js` for Google Drive discovery and `accounts.google.com/gsi/client` for account authentication. Sign-in retrieves the Google profile name and initializes `FrontBoard/<year>/<month>`.

## Privacy and security controls

- Guest documents are parsed locally and are not sent to a FrontBoard server.
- Google OAuth is used only after explicit user consent.
- The OAuth client secret is not stored in or shipped with this browser repository.
- Access tokens remain in browser memory and are not persisted to local storage.
- Signed-in user profile metadata is stored in local storage for interface display.
- Uploaded document data remains in the signed-in user's Google Drive.
- Users can sign out, revoke Google access, clear the board, and delete Drive files.
- Public pages use HTTPS through GitHub Pages.
- Legal pages: `privacy.html` and `terms.html`.
