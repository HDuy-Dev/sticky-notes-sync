# Google Sign-In Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Apps Script sync with "Sign in with Google": the extension finds or creates a "Sticky Notes Sync" spreadsheet in the user's own Drive and syncs to it via Drive/Sheets REST APIs; UI becomes English; repo becomes ready to publish on the Chrome Web Store.

**Architecture:** Three new modules behind the existing background single-writer design: `google-auth.js` (implicit-flow token via `chrome.identity.launchWebAuthFlow`, silent renewal), `sheets-store.js` (find/create spreadsheet, read rows, write rows), `sheet-rows.js` (pure row ↔ record conversion and write planning). `sync.js` keeps its round/coalescing/error-mapping shape but talks to an injected `remote` instead of Apps Script. Each round: read sheet → merge (LWW) → write only rows this device changed (update by row index, append new).

**Tech Stack:** Plain JS ES modules, Chrome MV3, Google Drive API v3 + Sheets API v4 (REST via `fetch`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-27-google-sign-in-design.md` (and, for unchanged note UI, `docs/superpowers/specs/2026-10-26-sticky-notes-sync-design.md`).

## Global Constraints

- OAuth scopes exactly: `openid email https://www.googleapis.com/auth/drive.file`. No client secret anywhere.
- Auth: `launchWebAuthFlow`, `response_type=token`, redirect `chrome.identity.getRedirectURL()`. Token in `chrome.storage.session`; account/spreadsheet in `chrome.storage.local`.
- Sheet name "Sticky Notes Sync", Drive `appProperties: { stickyNotesSync: 'v1' }`, tabs `Folders` (`id | name | order | updatedAt | deleted | updated`) and `Notes` (`id | folderId | folder | order | text | html | updatedAt | deleted | updated`). `updated` = ISO string.
- Writes use `valueInputOption=RAW`; reads use `valueRenderOption=UNFORMATTED_VALUE`. Never rewrite a whole tab, never delete rows.
- Keep: `MAX_NOTES = 3`, `MAX_HTML = 45000`, 2 s push debounce, 1-minute alarm, tombstones, LWW by `updatedAt`.
- UI English only. Apps Script code, URL/secret settings and config draft are removed.
- Commit messages English.
- **IP / policy:** no code, text, icons or screenshots copied from other extensions (the reference "Sticky Notes 3.8" is inspiration only); no third-party code or fonts (system font stack, hand-written SVG icons); no Google logo or Google trademark in the extension name or icon; the sign-in button follows Google's Sign in with Google branding guidelines (official button asset/colors, text "Sign in with Google"); store listing and privacy policy state the extension is not affiliated with Google and include the Google API Services User Data Policy "Limited Use" disclosure.

## Review Focus

1. **Token expires while the popup is open or overnight** — next sync renews silently; if silent renewal fails, status `signin` ("Sign in again"), dirty records kept. (Task 2 tests `silent renewal`, `silent failure throws AuthRequired`; Task 4 test `auth required keeps dirty and sets signin`.)
2. **Two devices sync concurrently** — each writes only its own changed rows; device B's round must not overwrite device A's rows it did not change. (Task 1 test `planWrites only touches changed records`.)
3. **Sheet deleted by the user** — next round creates a new sheet and pushes everything. (Task 3 test `readAll on missing sheet throws SheetMissing`; Task 4 test `missing sheet recreates and pushes all`.)
4. **Signing into a different account with local notes** — must ask before pushing local notes into the new account. (Task 4 test `signIn with different account needs confirmation`.)
5. **Duplicate rows for one id** (append retried after a lost response) — reader picks the newest and future updates target one row. (Task 1 test `duplicate ids keep newest row`.)

---

## File Structure

```
src/config.js                 # GOOGLE_CLIENT_ID, SCOPES, SHEET_NAME, APP_PROPERTY
src/lib/sheet-rows.js         # pure: columns, parse, row builders, planWrites
src/lib/google-auth.js        # createAuth(deps): token lifecycle
src/lib/sheets-store.js       # createSheetsStore(deps): Drive/Sheets REST
src/lib/sync.js               # createSyncer(deps) with remote adapter (rewritten)
src/lib/model.js              # + markAllDirty
src/background.js             # rewired messages
src/popup/*                   # English + Account panel
assets/icons/icon-{16,32,48,128}.png, store/*.png
PRIVACY.md, docs/PUBLISHING.md, README.md (English)
removed: apps-script/, tests/apps-script.test.js
```

Messages (popup → background), replacing `saveConfig`/`testConnection`:
- `{type:'getState'}` → `{ state, status, account }` where `account = { email } | null`
- `{type:'mutate', mutation}`, `{type:'syncNow'}` unchanged
- `{type:'signIn'}` → `{ok:true, email}` | `{ok:false, needsConfirm:true, email, previousEmail}` | `{ok:false, error}`
- `{type:'confirmSignIn'}` → `{ok:true, email}`; `{type:'cancelSignIn'}` → `{ok:true}`
- `{type:'signOut', keepNotes: boolean}` → `{ok:true}`

Status values: `off` (signed out), `syncing`, `idle`, `error`, `signin`.

---

### Task 1: Pure row model (`sheet-rows.js`)

**Files:** Create `src/lib/sheet-rows.js`, `tests/sheet-rows.test.js`

**Interfaces — Produces:**
- `FOLDER_COLUMNS`, `NOTE_COLUMNS` (arrays above); `TABS = { folders: 'Folders', notes: 'Notes' }`
- `parseTab(values: any[][], kind: 'folders'|'notes'): { records: Record[], rowById: { [id]: number } }` — `values[0]` is the header; row numbers are 1-based sheet rows; coerce types (`String` ids/text/html/name, `Number` order/updatedAt, `deleted === true || 'TRUE'`); skip rows with empty id; duplicate ids → keep max `updatedAt` and its row.
- `folderRow(folder): any[]`, `noteRow(note, folderName: string): any[]` (last cell ISO of `updatedAt`).
- `planWrites({ folders, notes }, rowIndex: { folders: rowById, notes: rowById }, state): { updates: { range: string, values: any[][] }[], appends: { Folders: any[][], Notes: any[][] } }` — record with a known row → update `Tab!A<r>:<lastCol><r>`; unknown → append. When a folder is in `folders`, also rewrite rows (update or append) of its live notes from `state` so the `folder` column follows renames.

- [ ] **Step 1: Tests** — `parses typed records and row numbers` (header + 2 rows → rows 2 and 3, numbers/booleans coerced, `'0912'` stays string); `skips empty rows`; `duplicate ids keep newest row`; `noteRow puts folder name and ISO date`; `planWrites updates known rows and appends new ones` (exact ranges `Notes!A2:I2`, `Folders!A3:F3`); `planWrites only touches changed records` (state with 3 notes, 1 changed → exactly 1 update); `folder rename rewrites its notes' folder column`.
- [ ] **Step 2:** `npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add sheet row model`.

### Task 2: Google auth (`google-auth.js`) + config + manifest

**Files:** Create `src/config.js`, `src/lib/google-auth.js`, `tests/google-auth.test.js`; Modify `manifest.json` (add `identity` permission; `host_permissions`: `https://www.googleapis.com/*`, `https://sheets.googleapis.com/*`, `https://openidconnect.googleapis.com/*`, `https://oauth2.googleapis.com/*`; remove script.google.com hosts; `version` `1.0.0`).

**Interfaces — Produces:**
- `config.js`: `GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com'`, `SCOPES`, `SHEET_NAME = 'Sticky Notes Sync'`, `APP_PROPERTY = { key: 'stickyNotesSync', value: 'v1' }`.
- `class AuthRequired extends Error`
- `buildAuthUrl({ clientId, redirectUri, interactive, loginHint }): string` — `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=token`, `scope`, `include_granted_scopes=true`, `prompt=select_account` (interactive) or `prompt=none` (silent), `login_hint` when given.
- `parseRedirect(url): { token, expiresIn } | { error }` (from the `#` fragment).
- `createAuth({ identity, session, local, fetchFn, clientId, now }) → { getToken({ interactive }): Promise<string>, signIn(): Promise<{ email, token }>, signOut(): Promise<void>, getAccount(): Promise<{email}|null>, invalidate(): Promise<void> }`
  - `session`/`local` are `{ get(key), set(obj), remove(key) }` (promise style, like `chrome.storage.*`).
  - `getToken`: cached `{token, expiresAt}` valid for > 60 s → return it; else silent `launchWebAuthFlow({ url, interactive: false })` with `login_hint` = stored email; any failure → `AuthRequired`.
  - `signIn`: interactive flow, then `GET https://openidconnect.googleapis.com/v1/userinfo` (Bearer) for `email`; stores token in session; does **not** store the account (background decides after the account-switch check) — returns `{ email, token }`.
  - `signOut`: `POST https://oauth2.googleapis.com/revoke?token=…` (ignore failure), clear session token and local `account`.
  - `invalidate`: drop the cached token (used after a 401).

- [ ] **Step 1: Tests** with fake `identity.launchWebAuthFlow` returning `https://x.chromiumapp.org/#access_token=T&expires_in=3600`: `buildAuthUrl silent vs interactive`; `parseRedirect token and error`; `cached token reused`; `silent renewal` (expired cache → silent call with `prompt=none` and `login_hint`); `silent failure throws AuthRequired`; `signIn returns email`; `signOut revokes and clears`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: add Google auth with silent renewal`.

### Task 3: Drive/Sheets store (`sheets-store.js`)

**Files:** Create `src/lib/sheets-store.js`, `tests/sheets-store.test.js`

**Interfaces:**
- Consumes: `parseTab`, `TABS`, columns (Task 1); `SHEET_NAME`, `APP_PROPERTY` (Task 2).
- Produces: `class SheetMissing extends Error`; `class ApiError extends Error { status }`;
  `createSheetsStore({ fetchFn, getToken, onUnauthorized }) → { findOrCreate(): Promise<{ spreadsheetId, created: boolean }>, readAll(id): Promise<{ folders, notes, rowIndex }>, write(id, plan): Promise<void>, url(id): string }`
  - Every request: `Authorization: Bearer <await getToken()>`; on 401 call `onUnauthorized()` then retry once; 404 on a spreadsheet → `SheetMissing`; other ≥ 400 → `ApiError`; `fetch` rejection → `TypeError` passes through (sync maps it).
  - `findOrCreate`: `GET drive/v3/files?q=appProperties has { key='stickyNotesSync' and value='v1' } and trashed=false&orderBy=createdTime&fields=files(id)&spaces=drive` → first id; else `POST drive/v3/files` (`mimeType: application/vnd.google-apps.spreadsheet`, name, appProperties) then `POST sheets/v4/spreadsheets/{id}:batchUpdate` adding `Folders` and `Notes` and deleting `sheetId: 0`, then `values:batchUpdate` RAW header rows.
  - `readAll`: `GET …/values:batchGet?ranges=Folders!A:F&ranges=Notes!A:I&valueRenderOption=UNFORMATTED_VALUE` → `parseTab` each.
  - `write`: one `values:batchUpdate` (RAW) for `plan.updates` if any; one `values/<Tab>!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS` per non-empty append list.
  - `url(id)` → `https://docs.google.com/spreadsheets/d/<id>/edit`.

- [ ] **Step 1: Tests** with a recording fake `fetchFn`: `findOrCreate reuses existing file`; `findOrCreate creates spreadsheet with tabs and headers` (asserts the 3 requests and bodies); `readAll parses both tabs`; `readAll on missing sheet throws SheetMissing`; `401 refreshes token once then retries`; `write sends one batchUpdate and per-tab appends, RAW`; `write with empty plan sends nothing`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat: add Drive and Sheets store`.

### Task 4: Sync engine + background rewiring; remove Apps Script

**Files:** Modify `src/lib/sync.js`, `src/lib/model.js`, `src/background.js`, `tests/sync.test.js`, `tests/model.test.js`; Delete `apps-script/`, `tests/apps-script.test.js`.

**Interfaces:**
- `model.js`: `markAllDirty(state): State` — every folder and note id dirty (tombstones included).
- `sync.js`: `createSyncer({ readState, updateState, setStatus, auth, store, getSheet, setSheet, now }) → { syncOnce(), signIn(), confirmSignIn(), cancelSignIn(), signOut(keepNotes) }`
  - `getSheet(): Promise<{ spreadsheetId, email } | null>`, `setSheet(v|null)`.
  - Round: no account → status `off`. `auth.getToken({interactive:false})` (AuthRequired → status `signin`, stop). Ensure sheet: stored sheet for this email, else `store.findOrCreate()`; when the spreadsheet id differs from the stored one (new/switched/recreated) → `updateState(markAllDirty)` and store it. `readAll` (SheetMissing → clear stored sheet, run ensure again once). `updateState(s => mergeRemote(s, remote, {}))`. `collectChanges` on fresh state → `planWrites(changes, rowIndex, state)` → `store.write`. Then `updateState(s => mergeRemote(s, changes, changes.sent))` to clear dirty only for unchanged records. Success → `{status:'idle', lastSyncAt, error:null, tooLong}`.
  - Error map: `TypeError` → `Can't reach Google`; `ApiError` → `Google returned an error (<status>)`; `AuthRequired` → status `signin`, error `Please sign in again`.
  - Keep coalescing (`syncOnce` during a round → exactly one more round).
  - `signIn()`: `auth.signIn()`; if a previous account email exists, differs, and `hasLocalNotes(state)` (any live note with non-empty text or any folder other than pristine default) → keep `{email,token}` pending and return `{ok:false, needsConfirm:true, email, previousEmail}`; else store account `{email}`, clear stored sheet if email changed, run `syncOnce()` and return `{ok:true, email}`.
  - `confirmSignIn()` commits the pending account the same way; `cancelSignIn()` → `auth.signOut()` and drop pending.
  - `signOut(keepNotes)`: `auth.signOut()`, `setSheet(null)`, status `off`; `keepNotes === false` → `updateState(() => defaultState())`. Previous email is remembered in local `lastEmail` for the switch check.
- `background.js`: build `auth` (`chrome.identity`, `chrome.storage.session/local`, `GOOGLE_CLIENT_ID`) and `store` (`onUnauthorized: auth.invalidate`); messages per the table above; `getState` returns `account`; alarm uses `hasPushable` as now.

- [ ] **Step 1: Tests** (`tests/sync.test.js` rewritten with fake `auth`/`store`): `pushes dirty records as row writes and clears dirty`; `keeps edits made during an in-flight sync dirty`; `pulls remote records before writing`; `new spreadsheet marks everything dirty`; `missing sheet recreates and pushes all`; `auth required keeps dirty and sets signin`; `network failure maps to Can't reach Google`; `signed out sets status off without network`; `concurrent calls coalesce`; `signIn with different account needs confirmation`; `cancelSignIn signs out`; `signOut without keepNotes resets state`. Model: `markAllDirty marks tombstones too`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `sync.js`, `markAllDirty`, `background.js`; delete Apps Script files. **Step 4:** PASS (full suite).
- [ ] **Step 5:** Commit `feat: sync through Google Sheets API`.

### Task 5: Popup — English UI, Account panel, dialogs

**Files:** Modify `src/popup/popup.html`, `popup.js`, `popup.css`, `editor.js`

Behavior:
- Translate every visible string, title and aria-label to English (e.g. `Add note (2/3)`, `3/3 notes`, `Delete this note?`, `Cancel`, `Delete`, `Copy note`, `Copied`, `Type or paste a note…`, `Select a note to format`, `Empty folder`, `Note too long (>45,000 characters) — not synced`, folder confirm `Delete folder "<name>" and its <n> notes? This can't be undone.`, color names `Blue/Red/Green/Orange/Purple/Gray`, rename `Rename (F2)`). `lang="en"`.
- Remove the URL/secret form, draft code and test-connection.
- Account panel (gear button → "Account"): signed out → text `Sync your notes to a Google Sheet in your own Drive.`, button `Sign in with Google`, note `Sticky Notes Sync can only access files it creates. Your notes are never sent to anyone else.`; signed in → `Signed in as <email>`, `Open Google Sheet` (new tab via `chrome.tabs.create` with `store.url`; background returns sheet url in `getState` as `sheetUrl`), `Sign out`.
- Sign-out confirm (inline, no browser dialogs): `Sign out of <email>?` + buttons `Keep notes on this device` / `Remove notes from this device` / `Cancel`.
- Account switch confirm after `needsConfirm`: `Notes on this device will be added to the Google Sheet of <email>.` + `Continue` / `Cancel`.
- Status chip text: `Not synced` (click → Account panel), `Syncing…`, `Synced` (title `Synced at HH:mm`), `Sync error` (title = error, click retries), `Sign in again` (click → `signIn`).

- [ ] **Step 1:** Implement.
- [ ] **Step 2: E2E in Chromium** (scratchpad harness): stub `chrome.identity.launchWebAuthFlow` in the service worker to return a fake token; route `googleapis.com` / `openidconnect` / `oauth2` to an in-memory fake Drive+Sheets server. Expected: sign in → sheet created with tabs and headers, notes pushed; edit → only that row updated; second profile signs in → same notes, no new spreadsheet; sign out keep/remove behave; different account → confirmation shown; token silent-renew failure → `Sign in again`; no page errors; no Vietnamese text left (`grep` the popup files for Vietnamese diacritics → none).
- [ ] **Step 3:** `npm test` PASS. Commit `feat: English popup with Google account panel`.

### Task 6: Store readiness — icons, assets, docs

**Files:** Create `assets/icons/icon-{16,32,48,128}.png`, `store/screenshot-1.png`, `store/screenshot-2.png` (1280×800), `PRIVACY.md`, `docs/privacy.html`, `docs/PUBLISHING.md`, `docs/COMPLIANCE.md`, `LICENSE`; Modify `manifest.json` (`icons`, `action.default_icon`, `description`), `README.md` (English, user-facing + dev section).

- Icon: rounded blue (`#1a4fa0`→`#2f6fe0`) square with a white folded-corner note and two short lines; rendered from an HTML/SVG source with Chromium screenshots (generator kept in `assets/icons/icon.svg` + note in PUBLISHING on how they were rendered).
- Screenshots: popup with sample notes, and the Account panel, centered on a light background at 1280×800.
- `PRIVACY.md` / `docs/privacy.html`: what is stored (notes locally; notes in the user's own Google Sheet), scopes and why, no developer servers/analytics, how to delete data (remove notes + delete the sheet + revoke at myaccount.google.com/permissions), contact email placeholder.
- `docs/PUBLISHING.md`: Google Cloud project; enable Drive API + Sheets API; OAuth consent screen (External, app name, support email, scopes `openid`, `email`, `drive.file`, privacy URL; Testing mode allows 100 test users until published); OAuth client **Web application** with redirect URIs `https://<dev-id>.chromiumapp.org/` and `https://<store-id>.chromiumapp.org/`; put client id in `src/config.js`; stable dev id via manifest `key` (generate with `openssl`, keep private key out of git, remove `key` before uploading to the Store); Web Store developer registration (US$5 once), zip command, listing text, privacy URL, review.

- `docs/COMPLIANCE.md` checklist, each item with how it is met: original code/assets (no copied files; `git log` authorship), no third-party code (no dependencies), Google sign-in branding (button built per [Sign in with Google Branding Guidelines](https://developers.google.com/identity/branding-guidelines)), Google API Services User Data Policy incl. Limited Use statement (in PRIVACY.md and listing), Chrome Web Store Program Policies (single purpose, minimum permissions with a one-line justification per permission for the dashboard), trademark notes (name avoids "Google"; "Google Sheets"/"Google Drive" only used descriptively with "not affiliated" disclaimer), name check result.
- `LICENSE` per the user's choice (see handoff question).

- [ ] **Step 1:** Create assets and docs. **Step 2:** Load extension in Chromium: icons present in manifest resolve (no load errors). **Step 3:** `npm test` PASS. Commit `docs: add store assets, privacy policy and publishing guide`.
