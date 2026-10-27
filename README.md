# Sticky Notes Sync

Quick formatted notes in your browser, synced to a Google Sheet in your own Google Drive.

![Sticky Notes Sync](store/screenshot-1.png)

- Folder tabs with up to three side-by-side notes each
- Bold, italic, underline, text colors and clickable links; pasting keeps simple formatting
- Saves automatically and works offline
- **Sign in with Google** to sync between computers. The extension creates a "Sticky Notes Sync" spreadsheet in your Drive and can only access files it created
- Works in Chromium browsers: Chrome, Edge, Brave, Cốc Cốc…

Privacy: [PRIVACY.md](PRIVACY.md). No developer servers, no analytics.

## Install for development

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder.
3. Sign-in needs your own Google OAuth client; follow [docs/PUBLISHING.md](docs/PUBLISHING.md) steps 1–3 and put the client ID in `src/config.js`. Without it, notes still work locally.

## How sync works

- The background service worker is the only writer of note data; the popup sends it changes.
- Each sync reads the spreadsheet, merges it with local data (the newest edit of each folder or note wins), then writes only the rows this device changed. Deleted items are kept as `deleted` rows so other devices learn about them.
- Sync runs about 2 seconds after an edit and retries every minute while something is still unsynced.

Code map: `src/lib/model.js` (data and mutations), `merge.js` (last-write-wins), `sheet-rows.js` (rows ↔ records), `google-auth.js` (sign-in and token renewal), `sheets-store.js` (Drive/Sheets REST), `sync.js` (sync rounds, sign-in/out), `src/popup/` (UI).

## Tests

```sh
npm test   # Node ≥ 20, no dependencies
```

## Publishing

See [docs/PUBLISHING.md](docs/PUBLISHING.md) and the checklist in [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## License

[MIT](LICENSE)
