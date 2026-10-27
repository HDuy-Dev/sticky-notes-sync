# Compliance checklist

What was checked before publishing, and how each point is met. This is a practical checklist, not legal advice.

## Intellectual property

| Item | How it is met |
| --- | --- |
| Original code | All code in `src/` was written for this project (see `git log`). Nothing was copied from other extensions; "Sticky Notes 3.8 – super quick" was only a feature reference. |
| Original visuals | Icon (`assets/icons/icon.svg`) and UI were designed for this project. Screenshots show the extension itself with made-up sample notes. |
| Third-party code | None. No npm dependencies, no bundled libraries or fonts (system font stack). |
| Licence | MIT (`LICENSE`). |
| Name | "Sticky Notes Sync": no extension with this exact name was found in a web search on 2026-10-27. "Sticky notes" is a generic description; the name contains no third-party brand. A formal trademark search is recommended if the product becomes commercial. |

## Google branding and trademarks

| Item | How it is met |
| --- | --- |
| Sign in button | Built per the [Sign in with Google Branding Guidelines](https://developers.google.com/identity/branding-guidelines): standard multicolor "G" logo, white background, `#747775` border, `#1F1F1F` text, text "Sign in with Google", 40 px tall. Uses Roboto when installed, otherwise Arial. |
| No Google marks in our brand | Extension name and icon contain no Google name or logo. |
| Descriptive use only | "Google Sheet"/"Google Drive" are used only to describe where data is stored, with the line "Not affiliated with Google. Google Sheets and Google Drive are trademarks of Google LLC." in the Account panel, store listing and privacy policy. |

## Google API Services User Data Policy

| Item | How it is met |
| --- | --- |
| Minimum scopes | `openid`, `email`, `drive.file` only (no `drive` or `spreadsheets`). `drive.file` limits access to files the app created. |
| Limited Use disclosure | In `PRIVACY.md` / `docs/privacy.html` ("Google API Services User Data Policy" section). |
| No transfer / no ads / no human reading | No developer servers or analytics. Data goes only between the browser and Google. |
| No client secret | Implicit OAuth flow via `chrome.identity.launchWebAuthFlow`; only the public client ID ships in `src/config.js`. |

## Chrome Web Store Program Policies

**Single purpose:** Write quick formatted notes in the browser and optionally sync them to a Google Sheet in the user's own Google Drive.

Permission justifications (paste into the Privacy practices tab):

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's notes, folders and sync status locally so they appear instantly and work offline. |
| `alarms` | Retries syncing once a minute when an earlier sync failed (for example while offline). |
| `identity` | Lets the user sign in with Google to sync notes to their own Google Sheet. |
| `clipboardWrite` | The "Copy note" button copies a note with its formatting. |
| Host `www.googleapis.com` | Google Drive API: find or create the user's "Sticky Notes Sync" spreadsheet. |
| Host `sheets.googleapis.com` | Google Sheets API: read and write the user's notes in that spreadsheet. |
| Host `openidconnect.googleapis.com` | Read the signed-in account's email address to display it. |
| Host `oauth2.googleapis.com` | Revoke the Google token when the user signs out. |

Remote code: none. All JavaScript ships in the package.

## Before each release

- [ ] `npm test` passes.
- [ ] `grep -r "YOUR_CLIENT_ID\|CONTACT_EMAIL" src PRIVACY.md docs/privacy.html` returns nothing.
- [ ] Upload zip built with `npm run build` (drops the manifest `"key"`).
- [ ] Privacy policy URL is public and matches the OAuth consent screen.
