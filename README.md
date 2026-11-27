# FrontBoard

A browser-based travel board that extracts flight, bus, train, and hotel details from uploaded documents.

## Features

- Eastern Time clock, date-sorted ticket feed, and travel-type filters
- Month-based travel history for completed trips
- Local extraction from CSV, JSON, TXT, and PDF
- Google account sign-in for identity only; no Google Drive access is requested
- First-upload notice and explicit consent before cloud storage
- Private Supabase Storage for each original document and its extracted JSON
- Per-user saved-document list with downloads and paired deletion
- User-scoped object paths: `users/<supabase-user-id>/FrontBoard/<document-id>/`

## Run locally

Serve the project over HTTP rather than opening `index.html` directly:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. Add that origin to the Google OAuth client's authorized JavaScript origins if you test sign-in locally. The published origin is `https://careerelevate.github.io`.

## Supabase setup

The current project uses Supabase Auth and a private Storage bucket. The Supabase JavaScript SDK is loaded from jsDelivr; no service-role or secret API key is used in the browser.

1. In Supabase, run [`supabase-setup.sql`](supabase-setup.sql) in the SQL Editor. It creates the RLS-protected metadata and consent tables, restricts the `frontboard-private` bucket to authenticated user paths, and applies the 15 MB file limit and accepted MIME types.
2. In **Authentication → Sign In / Providers → Google**, enable Google sign-in and add the same Google client ID used by `frontboard-config.js`. FrontBoard uses Google One Tap ID tokens through `signInWithIdToken`; it does not use Supabase's redirect OAuth flow, so no client secret is needed for this configuration.
3. Keep the Supabase project URL and **publishable** key in `frontboard-config.js`. Publishable keys are intended for public clients; never add a Supabase secret/service-role key to this repository.
4. Ensure the Google OAuth client has the published site origin authorized. Add `http://localhost:8000` only when testing locally.

The project URL and publishable key currently point to the FrontBoard Supabase project. If you replace that project, update both values and configure its Google provider and private bucket before publishing.

### Storage behavior

- Guest uploads are parsed locally and are not sent to Supabase.
- On the first upload, signed-in users must accept the storage notice. Declining keeps the document local.
- Accepted uploads store the original and a `record.json` file under the user's private storage prefix.
- Supabase RLS policies scope consent, metadata, and file operations to the authenticated user. The bucket is not public.
- **Delete** removes the original, its JSON file, and its metadata. **Clear local board** only clears the current browser view.
- The Supabase auth session is held in memory and is not persisted across reloads. The account name and email are stored in browser local storage for display; no Google token is saved there.

Review current [Supabase pricing](https://supabase.com/pricing) and usage limits before relying on cloud storage at scale.

## Tests

Run the storage and travel parsing regression tests with:

```powershell
node --test frontboard-storage.test.mjs travel-board.test.mjs
```

## Legal pages

See [Privacy Policy](privacy.html) and [Terms of Service](terms.html) for current storage, consent, and deletion disclosures.
