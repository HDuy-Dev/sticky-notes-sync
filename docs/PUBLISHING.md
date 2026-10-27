# Publishing Sticky Notes Sync

One-time setup for the developer: a Google Cloud OAuth client so users can sign in, then the Chrome Web Store listing.

## 1. Give the dev build a stable extension ID

The OAuth redirect URI contains the extension ID, so the unpacked build needs a fixed one.

```sh
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out ~/sticky-notes-sync-key.pem   # keep OUT of git
openssl rsa -in ~/sticky-notes-sync-key.pem -pubout -outform DER | openssl base64 -A    # prints the public key
```

Add the printed value to `manifest.json` as `"key": "<public key>"`, reload the extension in `chrome://extensions`, and note its ID (`<dev-id>`).

## 2. Google Cloud project

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Sticky Notes Sync").
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Sheets API**.
3. **OAuth consent screen** (Google Auth Platform):
   - User type: **External**.
   - App name "Sticky Notes Sync", support email, app logo (`assets/icons/icon-128.png`), developer contact email.
   - App domain → Privacy policy URL: the public URL of `docs/privacy.html` (see step 5).
   - Scopes: `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`. All are non-sensitive, so no security assessment is required.
   - While the app is in **Testing**, only listed test users (max 100) can sign in. Add yourself. Click **Publish app** when going live; Google may ask for brand verification (name, logo, domain), which is a short review.
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs: `https://<dev-id>.chromiumapp.org/` (add the store one later).
5. Copy the client ID into `src/config.js` (`GOOGLE_CLIENT_ID`). It is public, not a secret. Never add a client secret to the extension.

## 3. Test sign-in

Reload the extension, open the popup → gear → **Sign in with Google**. Expect a "Sticky Notes Sync" spreadsheet in your Drive with `Folders` and `Notes` tabs. Repeat in a second Chromium browser (Edge/Brave) to check sync.

## 4. Chrome Web Store

1. Register at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 fee).
2. Remove the `"key"` field from `manifest.json` for the upload copy, then build the zip from the repo root:
   ```sh
   zip -r sticky-notes-sync.zip manifest.json src assets LICENSE -x '*.DS_Store'
   ```
3. Upload. The store assigns the final ID (`<store-id>`). Add `https://<store-id>.chromiumapp.org/` to the OAuth client's redirect URIs.
4. Listing:
   - Description: see "Store listing text" below.
   - Icon: `assets/icons/icon-128.png`. Screenshots: `store/screenshot-1.png`, `store/screenshot-2.png` (1280×800).
   - Category: Productivity. Language: English.
   - Privacy practices tab: paste the single purpose and permission justifications from `docs/COMPLIANCE.md`. Data usage: declare **Personally identifiable information** (the email address). Note contents never reach the developer; if the form still asks, pick the closest category and say they are stored only in the user's own browser and Google Drive. Re-read the form's current wording when submitting, since categories change. Tick the three Limited Use certifications.
   - Privacy policy URL: same as the OAuth consent screen.
5. Submit for review.

## 5. Hosting the privacy policy

The policy must be reachable at a public URL. Options:
- Public GitHub repo → enable GitHub Pages for `/docs` and use `https://<user>.github.io/sticky-notes-sync/privacy.html`.
- Private repo → paste `PRIVACY.md` into a Google Doc, **File → Share → Publish to web**, and use that link.

Replace `[CONTACT_EMAIL]` in `PRIVACY.md` and `docs/privacy.html` first.

## Store listing text

> **Sticky Notes Sync** — quick formatted notes in your browser, synced to a Google Sheet in your own Drive.
>
> • Organise notes in folder tabs, up to three side-by-side notes per folder
> • Bold, italic, underline, colors and clickable links; pasting keeps simple formatting
> • Works offline; everything saves automatically
> • Sign in with Google to sync between computers. Notes live in a "Sticky Notes Sync" spreadsheet in your own Drive
> • Private by design: the extension can only access files it creates, and no data is sent to the developer
>
> Not affiliated with Google. Google Drive and Google Sheets are trademarks of Google LLC.

## Icons

`assets/icons/icon.svg` is the source. The PNGs were rendered from it with headless Chromium at 16, 32, 48 and 128 px; re-render after editing the SVG.
