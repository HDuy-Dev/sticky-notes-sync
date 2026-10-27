# Sticky Notes Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension with folder tabs of up to 3 rich-text notes each, saved locally and synced to the user's own Google Sheet through an Apps Script Web App.

**Architecture:** The background service worker is the **only writer** of note data: the popup sends mutations as messages, the worker applies them in a serialized queue to `chrome.storage.local`, marks records dirty, and pushes dirty records to Apps Script (debounced, plus a 1-minute retry alarm). Sync is last-write-wins per record by `updatedAt`, implemented once in `src/lib/merge.js` and mirrored in `apps-script/Code.gs`. The popup renders from storage and re-renders on `chrome.storage.onChanged`.

**Tech Stack:** Plain JavaScript ES modules, Chrome MV3 (service worker `type: module`), Google Apps Script, `node --test` (Node ≥ 20, no npm dependencies).

**Spec:** `docs/superpowers/specs/2026-10-26-sticky-notes-sync-design.md`. Visual reference: `mockup/popup-mockup.html` (the popup must match it; copy its CSS tokens and layout).

## Global Constraints

- Chrome MV3, installed via "Load unpacked". No framework, no build step, no npm dependencies.
- Popup size 780×560 (Chrome max 800×600).
- `MAX_NOTES = 3` live notes per folder; a new folder gets 2 empty notes; at least 1 live folder always remains.
- Note HTML longer than `MAX_HTML = 45000` characters is never sent to the Sheet; the note shows a warning instead.
- Deletes are tombstones (`deleted: true`), never row removals.
- Data goes only to the user's own Apps Script URL. Every request carries the user's secret; the script rejects a wrong secret.
- No `alert()`/`confirm()`/`prompt()` anywhere.
- Primary color tokens (blue): `--brand-900 #0b2a5b`, `--brand-700 #1a4fa0`, `--brand-500 #2f6fe0`, `--brand-300 #c3d6f7`, `--brand-100 #e6eefc`, `--bg #f2f5fa`, `--border #d5deeb`.
- UI copy in Vietnamese, exactly as in the mockup. Code, comments and commit messages in English.

## Review Focus

1. **Edit during an in-flight sync** — the user types while a push is on the wire; that newer edit must stay dirty and be pushed next round, never overwritten by the server's reply. (Task 4 test `keeps edits made during an in-flight sync dirty`.)
2. **Sync failure of any kind** (offline, HTTP 500, wrong secret, script deployed without "Anyone" access so Google returns an HTML login page) — status becomes `error` with a readable Vietnamese reason, nothing local is lost, dirty records stay for retry. (Task 4 tests `failed fetch keeps dirty records` and `non-JSON response reports access error`.)
3. **Second browser, fresh install** — must not create a duplicate "Folder 1" on the Sheet. (Task 1 test `default folder is not dirty`; Task 3 test `remote default folder wins over pristine local default`.)
4. **Pasting hostile HTML** (`<script>`, `onerror=`, `javascript:` links, `<style>`) — stripped; allowed formatting kept. (Task 2 tests.)
5. **Very long note** (> 45000 chars HTML) — not sent, stays dirty, `tooLong` reported so the popup can warn. (Task 3 test `collectChanges skips too-long notes`.)

---

## File Structure

```
sticky-notes-sync/
  manifest.json
  package.json                 # {"type":"module","scripts":{"test":"node --test tests/"}}
  README.md                    # install + Apps Script setup steps
  apps-script/Code.gs          # Web App: doPost, LWW merge into Sheet
  src/
    background.js              # service worker: queue, messages, alarms, wires syncer
    lib/model.js               # constants, ids, default state, applyMutation, selectors
    lib/sanitize.js            # allowlist HTML sanitizer (string tokenizer, no DOM)
    lib/merge.js               # collectChanges, mergeRemote (LWW)
    lib/sync.js                # createSyncer(deps): one sync round, error mapping
    popup/popup.html
    popup/popup.css            # from mockup
    popup/popup.js             # render tabs/notes, settings, status, storage listener
    popup/editor.js            # toolbar, selection memory, paste, link popover, copy
  tests/
    model.test.js  sanitize.test.js  merge.test.js  sync.test.js  apps-script.test.js
  mockup/  docs/               # existing
```

## Shared data shapes (used by every task)

```js
// Folder: { id: string, name: string, order: number, updatedAt: number, deleted: boolean }
// Note:   { id: string, folderId: string, order: number, html: string, text: string,
//           updatedAt: number, deleted: boolean }
// State:  { folders: { [id]: Folder }, notes: { [id]: Note }, dirty: { [id]: true } }
// Config: { url: string, secret: string }                       storage key "config"
// SyncStatus: { status: 'off'|'idle'|'syncing'|'error', lastSyncAt: number|null,
//               error: string|null, tooLong: string[] }         storage key "syncStatus"
// State lives under storage key "state".
```

Sync wire protocol (POST body sent as `Content-Type: text/plain`, JSON string):
- Request: `{ secret, action: 'sync', folders: Folder[], notes: Note[] }` (only changed records; empty arrays allowed)
- Success: `{ ok: true, folders: Folder[], notes: Note[] }` (all records, tombstones included)
- Failure: `{ ok: false, error: 'unauthorized' | 'bad_request' | string }`

Popup → background messages (`chrome.runtime.sendMessage`), each resolves to a response object:
- `{ type: 'getState' }` → `{ state, config, status }`
- `{ type: 'mutate', mutation }` → `{ ok: true } | { ok: false, error }`
- `{ type: 'syncNow' }` → `{ ok: boolean }`
- `{ type: 'saveConfig', config }` → `{ ok: true }`
- `{ type: 'testConnection', config }` → `{ ok: true, folders: number, notes: number } | { ok: false, error }`

---

### Task 1: Scaffold + data model

**Files:**
- Create: `manifest.json`, `package.json`, `.gitignore`, `src/lib/model.js`
- Test: `tests/model.test.js`

**Interfaces:**
- Produces (from `src/lib/model.js`):
  - `MAX_NOTES = 3`, `MAX_HTML = 45000`, `DEFAULT_FOLDER_ID = 'default'`
  - `newId(): string` — `crypto.randomUUID()`
  - `defaultState(): State` — folder `{id:'default', name:'Folder 1', order:0, updatedAt:0}` with notes `default-n1`, `default-n2` (`updatedAt: 0`, empty html/text), `dirty: {}`
  - `applyMutation(state: State, mutation, now: number): { state: State } | { error: string }` — pure, returns a new object. Mutations:
    - `{ type:'addFolder', id, name, noteIds:[id,id] }` — order = max live order + 1; creates 2 notes
    - `{ type:'renameFolder', id, name }` — name trimmed, max 30 chars, empty → error `'empty_name'`
    - `{ type:'deleteFolder', id }` — tombstones folder and all its notes; error `'last_folder'` if it is the only live folder
    - `{ type:'addNote', id, folderId }` — error `'max_notes'` if folder already has 3 live notes
    - `{ type:'editNote', id, html, text }`
    - `{ type:'deleteNote', id }`
    Every touched record gets `updatedAt = now` and `dirty[id] = true`.
  - `liveFolders(state): Folder[]` sorted by `order`; `liveNotes(state, folderId): Note[]` sorted by `order`

- [ ] **Step 1: `git init`, create `package.json` (`"type":"module"`, test script), `.gitignore` (`node_modules/`, `.DS_Store`), and `manifest.json`**: `manifest_version: 3`, name "Sticky Notes Sync", `action.default_popup: "src/popup/popup.html"`, `background: { service_worker: "src/background.js", type: "module" }`, `permissions: ["storage", "alarms", "clipboardWrite"]`, `host_permissions: ["https://script.google.com/*", "https://script.googleusercontent.com/*"]`.

- [ ] **Step 2: Write failing tests in `tests/model.test.js`**
  - `default folder is not dirty`: `defaultState()` has one live folder `'default'` named `'Folder 1'`, 2 live notes, `dirty` empty, all `updatedAt === 0`.
  - `addFolder creates two empty notes and marks dirty`: after mutation at `now=1000`, `liveNotes(s, id).length === 2`, `dirty` has folder + both note ids, folder `updatedAt === 1000`.
  - `addNote refuses a fourth note`: folder with 3 live notes → `{ error: 'max_notes' }`.
  - `deleteFolder tombstones notes and refuses last folder`: deleting the only folder → `{ error: 'last_folder' }`; with two folders, deleted folder and its notes have `deleted: true` and are dirty, `liveFolders` excludes it.
  - `renameFolder trims and rejects empty`: `'  A  '` → `'A'`; `'   '` → `{ error: 'empty_name' }`.
  - `applyMutation does not mutate input`: deep-equal the input before/after.

- [ ] **Step 3: Run `npm test` — expect FAIL (module not found).**
- [ ] **Step 4: Implement `src/lib/model.js`.**
- [ ] **Step 5: Run `npm test` — expect PASS.**
- [ ] **Step 6: Commit** `feat: scaffold extension and data model`

### Task 2: HTML sanitizer

**Files:**
- Create: `src/lib/sanitize.js`
- Test: `tests/sanitize.test.js`

**Interfaces:**
- Produces: `sanitizeHtml(html: string): string`, `htmlToText(html: string): string` (strip tags, `<br>`/block ends → `\n`, decode `&amp; &lt; &gt; &quot; &#39; &nbsp;`)

Rules: allowed tags `b strong i em u a br div p ul ol li span font`. `a` keeps only `href` with scheme `http:`, `https:` or `mailto:` (others: drop the attribute), and always gets `target="_blank" rel="noopener noreferrer"`. `span` keeps only `style` reduced to a `color:` declaration; `font` keeps only `color`. Color value must match `/^(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|[a-z]{3,20})$/i`. Content of `script style head title iframe object embed template` is dropped entirely; any other tag is unwrapped (text kept). Comments dropped. Text outside tags is re-escaped (`<` `>` not part of a tag). Approach: tokenize with a regex over `<!--…-->`, `<\/?[a-zA-Z][^>]*>`, and text; rebuild output only from allowed tokens; track unclosed allowed tags and close them at the end.

- [ ] **Step 1: Write failing tests**
  - `keeps allowed formatting`: `'<b>x</b><i>y</i><u>z</u><br>'` unchanged.
  - `strips script and event handlers`: `'<img src=x onerror=alert(1)><script>alert(1)</script>ok'` → `'ok'`.
  - `drops javascript links but keeps text`: `'<a href="javascript:alert(1)">t</a>'` → `'<a target="_blank" rel="noopener noreferrer">t</a>'`.
  - `keeps http link with safe attrs`: `'<a href="http://localhost:3000/x?a=1&amp;b=2" onclick="x">L</a>'` → `'<a href="http://localhost:3000/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">L</a>'`.
  - `keeps only color style`: `'<span style="color: #1a73e8; font-size: 40px">A</span>'` → `'<span style="color: #1a73e8">A</span>'`; `'<span style="color: expression(x)">A</span>'` → `'<span>A</span>'`.
  - `unwraps unknown tags`: `'<table><tr><td>a</td></tr></table>'` → `'a'`.
  - `drops style blocks`: `'<style>b{}</style>x'` → `'x'`.
  - `closes unclosed tags`: `'<b>x'` → `'<b>x</b>'`.
  - `htmlToText`: `'<b>A</b><br>B&amp;C<div>D</div>'` → `'A\nB&C\nD'`.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement `src/lib/sanitize.js`.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: add allowlist HTML sanitizer`

### Task 3: Merge logic

**Files:**
- Create: `src/lib/merge.js`
- Test: `tests/merge.test.js`

**Interfaces:**
- Consumes: `MAX_HTML` from model.
- Produces:
  - `collectChanges(state): { folders: Folder[], notes: Note[], sent: { [id]: number }, tooLong: string[] }` — dirty records only; a dirty note with `html.length > MAX_HTML` goes to `tooLong`, not to `notes`/`sent`.
  - `mergeRemote(state, remote: { folders, notes }, sent): State` — for each remote record: take it if no local record or `remote.updatedAt > local.updatedAt`. Then for each id in `sent`: clear `dirty[id]` if the local record's `updatedAt === sent[id]` (unchanged since sending) or remote replaced it. A local record whose `updatedAt` is newer than `sent[id]` stays dirty. Remote `html` is passed through `sanitizeHtml` before storing.

- [ ] **Step 1: Write failing tests**
  - `collectChanges returns only dirty records`.
  - `collectChanges skips too-long notes`: dirty note with 45001-char html → in `tooLong`, absent from `notes` and `sent`, still dirty in state.
  - `remote newer wins, local newer kept`: local note `updatedAt 5`, remote `7` → remote; local `9`, remote `7` → local stays and stays dirty if dirty and not in `sent`.
  - `clears dirty only for unchanged sent records`: sent `{a:5}`, local `a.updatedAt` 5 → clean; local `a.updatedAt` 6 → still dirty.
  - `remote default folder wins over pristine local default`: local `defaultState()`, remote has `default` renamed `'Work'` with `updatedAt 100` → local name `'Work'`, dirty empty.
  - `remote tombstone hides folder`: remote folder `deleted:true, updatedAt` newer → `liveFolders` excludes it.
  - `remote html is sanitized`: remote note html `'<script>x</script>y'` → stored `'y'`.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement `src/lib/merge.js`.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: add last-write-wins merge`

### Task 4: Sync engine + background service worker

**Files:**
- Create: `src/lib/sync.js`, `src/background.js`
- Test: `tests/sync.test.js`

**Interfaces:**
- Consumes: `collectChanges`, `mergeRemote` (Task 3); `applyMutation`, `defaultState` (Task 1).
- Produces:
  - `createSyncer({ readState, updateState, getConfig, setStatus, fetchFn, now }) → { syncOnce(): Promise<void>, testConnection(config): Promise<{ok:true,folders,notes}|{ok:false,error}> }`
    - `readState(): Promise<State>`; `updateState(fn: (State) => State): Promise<State>` (serialized by the caller); `getConfig(): Promise<Config|null>`; `setStatus(patch): Promise<void>`.
    - `syncOnce`: no config (missing url or secret) → `setStatus({status:'off'})` and return. Else `setStatus({status:'syncing'})`, `collectChanges` on a fresh read, POST, then `updateState(s => mergeRemote(s, remote, sent))` — merging into the **current** state, not the one read before the fetch. Success → `{status:'idle', lastSyncAt: now(), error:null, tooLong}`.
    - Concurrent calls share one in-flight promise; if called again while running, run exactly one more round afterwards.
    - Error mapping to `status:'error'` with `error` text: network failure → `'Không kết nối được tới Google Sheet'`; HTTP ≥ 400 → `'Google Sheet trả lỗi HTTP <code>'`; body not JSON → `'Script chưa được deploy với quyền "Anyone" hoặc URL sai'`; `{ok:false,error:'unauthorized'}` → `'Sai mã bí mật'`; other `ok:false` → `'Lỗi từ script: <error>'`. State is untouched on error.
    - `testConnection(config)`: POST with empty arrays, does not touch state; returns live counts (records with `deleted !== true`) or the same error texts.
- `src/background.js` wiring:
  - A promise-chain queue `enqueue(fn)`; `updateState` reads `state` (falls back to `defaultState()`), applies `fn`, writes it, all inside the queue.
  - `onMessage` handles the five messages in "Shared data shapes" (return `true` for async `sendResponse`). `mutate` → `updateState` with `applyMutation(…, Date.now())`; on `{error}` respond `{ok:false,error}`; on success schedule a sync in 2000 ms (debounced; reset on each mutation).
  - `chrome.alarms.create('sync', { periodInMinutes: 1 })` on `runtime.onInstalled` and `onStartup`; on alarm, `syncOnce()` only if `state.dirty` is non-empty.
  - `saveConfig` stores config then calls `syncOnce()`.

- [ ] **Step 1: Write failing tests in `tests/sync.test.js`** using in-memory fakes (state object, `updateState` applying fn synchronously, `fetchFn` returning `{ ok, status, text: async () => body }`):
  - `pushes dirty records and clears them`: one dirty note → request body has it with correct `secret`; after sync dirty empty, status `idle`.
  - `keeps edits made during an in-flight sync dirty`: `fetchFn` awaits a gate; while pending, `updateState` applies an `editNote` with a later `now`; release the gate with the server echoing the old version → the note keeps the new html and stays dirty.
  - `failed fetch keeps dirty records`: `fetchFn` rejects → status `error`, error `'Không kết nối được tới Google Sheet'`, dirty unchanged.
  - `non-JSON response reports access error`: body `'<!DOCTYPE html>…'` → error `'Script chưa được deploy với quyền "Anyone" hoặc URL sai'`.
  - `wrong secret`: body `{"ok":false,"error":"unauthorized"}` → `'Sai mã bí mật'`.
  - `no config sets status off and does not fetch`.
  - `concurrent calls coalesce`: three `syncOnce()` calls during one in-flight fetch → `fetchFn` called exactly 2 times.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement `src/lib/sync.js`.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Implement `src/background.js`** (thin wiring, not unit-tested).
- [ ] **Step 6: Load unpacked in `chrome://extensions` and open the service worker console.** Run `await chrome.storage.local.get(null)` and `(await chrome.alarms.getAll()).map(a => a.name)`. Expected: no errors on load, alarm list contains `'sync'`.
- [ ] **Step 7: Commit** `feat: add sync engine and background worker`

### Task 5: Apps Script backend + setup guide

**Files:**
- Create: `apps-script/Code.gs`, `README.md`
- Test: `tests/apps-script.test.js`

**Interfaces:**
- Consumes: wire protocol above; must use the same LWW rule as `mergeRemote` (newer `updatedAt` wins; ties keep the existing row).
- Produces in `Code.gs` (top-level functions, no modules):
  - `const SECRET = 'CHANGE_ME';` at the top with a Vietnamese comment telling the user to change it.
  - `doPost(e)` — parse `e.postData.contents`; secret mismatch → `{ok:false,error:'unauthorized'}`; `action !== 'sync'` → `{ok:false,error:'bad_request'}`; under `LockService.getScriptLock().waitLock(10000)` read both sheets, merge, write back, return all records. Responses via `ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON)`.
  - `mergeRecords_(existing: object[], incoming: object[]): object[]` — pure, keyed by `id`.
  - Sheets created on demand with header rows:
    - `Folders`: `id | name | order | updatedAt | deleted | updated`
    - `Notes`: `id | folderId | folder | order | text | html | updatedAt | deleted | updated`
    `updated` is a human-readable date (`new Date(updatedAt)`); `folder` is the folder's current name; `text` is the note's plain text as sent by the client. Rows are rewritten in full each sync (sorted: folders by order; notes by folder order then note order).
- README sections (Vietnamese): Cài extension (Load unpacked) · Tạo Google Sheet và dán `Code.gs` (Extensions → Apps Script) · Đổi `SECRET` · Deploy → New deployment → Web app, Execute as **Me**, Who has access **Anyone** · Copy URL `/exec` vào Cài đặt của extension cùng mã bí mật · Bấm "Kiểm tra kết nối" · Lưu ý bảo mật (URL + mã = quyền đọc toàn bộ note; mỗi lần sửa script phải Deploy → Manage deployments → New version).

- [ ] **Step 1: Write failing tests in `tests/apps-script.test.js`**: load `Code.gs` with `vm.runInNewContext(source, sandbox)` (sandbox stubs `LockService`, `ContentService`, `SpreadsheetApp` minimally) and assert on `sandbox.mergeRecords_`:
  - `newer incoming replaces existing`, `older incoming ignored`, `tie keeps existing`, `new ids appended`.
  - `doPost rejects wrong secret`: with stubbed `ContentService` capturing text, body `{secret:'x'}` → parsed output `{ok:false,error:'unauthorized'}`.
- [ ] **Step 2: Run `npm test` — expect FAIL.**
- [ ] **Step 3: Implement `apps-script/Code.gs` and write `README.md`.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: add Apps Script backend and setup guide`

### Task 6: Popup — layout, tabs, notes

**Files:**
- Create: `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`

**Interfaces:**
- Consumes: messages (Shared data shapes); `liveFolders`, `liveNotes`, `MAX_NOTES`, `newId` (Task 1); `sanitizeHtml`, `htmlToText` (Task 2).
- Produces for Task 7: `popup.js` exports nothing; it calls `initEditor({ toolbarEl, onNoteInput })` from `editor.js` (Task 7 provides it; in this task create `editor.js` with `export function initEditor() { return { attach(bodyEl) {} }; }` as a stub). `attach(bodyEl)` is called for every rendered note body.

Behavior (match the mockup markup/CSS; copy its `<style>` into `popup.css` minus the mockup-only `.caption`, theme picker and page centering; body is exactly 780×560):
- On open: `getState` → render; then `syncNow`. Remember the active folder id in `localStorage` key `activeFolder` (try/catch).
- Tabs: click selects; ← / → move; double-click, F2 or the pen button → inline rename input (Enter/blur saves via `renameFolder`, Esc cancels). `+` → `addFolder` with fresh ids, select it, open rename. Trash → inline confirm bar `Xóa thư mục "<name>" và <n> note bên trong? Không thể hoàn tác.` → `deleteFolder`; trash disabled with title `Cần giữ ít nhất 1 thư mục` when only one live folder.
- Notes grid: `--cols` = live note count (min 1), each note full height with own scroll. Head row `Note <n>` + copy + delete; delete shows overlay `Xóa note này?` [Hủy] [Xóa]. Toolbar button `Thêm note (<n>/3)` / disabled `Đủ 3/3 note`. Empty folder text as in mockup.
- Typing: on `input`, debounce 300 ms, then `mutate editNote` with `html = sanitizeHtml(body.innerHTML)` and `text = htmlToText(html)`. Flush pending edits immediately on `visibilitychange` (hidden) and `pagehide`.
- Re-render on `chrome.storage.onChanged` (`state`, `syncStatus`): rebuild tabs and grid, but for a note body that currently has focus **do not replace its innerHTML**; other notes get `sanitizeHtml(note.html)` only if different from current.
- A note id listed in `status.tooLong` shows a red line under its head: `Note quá dài (>45.000 ký tự), không đồng bộ được lên Sheet.`

- [ ] **Step 1: Create the three files and the `editor.js` stub.**
- [ ] **Step 2: Reload the extension, open the popup.** Expected: blue header with `FOLDER 1` tab, two empty notes, `Thêm note (2/3)`.
- [ ] **Step 3: Manual check** — add folder (opens rename), rename to `Test`, add a third note (button becomes `Đủ 3/3 note`), delete a note via overlay, delete folder via confirm bar, close and reopen popup: everything persists, active folder remembered. Type, close the popup within 1 s, reopen: text kept.
- [ ] **Step 4: `npm test` still passes.**
- [ ] **Step 5: Commit** `feat: add popup layout with folders and notes`

### Task 7: Editor — formatting, paste, links, copy

**Files:**
- Modify: `src/popup/editor.js` (replace stub)

**Interfaces:**
- Consumes: `sanitizeHtml` (Task 2); called by `popup.js` as `initEditor({ toolbarEl, onNoteInput })` → `{ attach(bodyEl) }`. `onNoteInput(bodyEl)` must be called after any toolbar/paste change so Task 6's debounce saves it.

Behavior (port from the mockup script):
- Remember last focused body and its selection (`selectionchange`); toolbar stays enabled after focus leaves the note; disabled + hint `Chọn một note để định dạng` until a note was focused in the current folder.
- B / I / U via `document.execCommand`; `aria-pressed` from `queryCommandState`. 6 color swatches (`#1a73e8 #d93025 #188038 #e8710a #8430ce #5f6368`, titles `Màu chữ: Xanh dương/Đỏ/Xanh lá/Cam/Tím/Xám`) via `foreColor`. Remove format via `removeFormat` + `unlink`.
- Link popover (Ctrl/Cmd+K or toolbar): input prefilled if selection is a URL; adds `https://` when no scheme; wraps selection via `createLink`, or inserts the URL as a link when the selection is empty.
- Paste: `preventDefault`, take `text/html` (else escaped `text/plain` with newlines → `<br>`), `sanitizeHtml`, `insertHTML`.
- Clicking a link inside a note opens it with `chrome.tabs.create({ url: a.href })` (Claude's call: plain click opens, matching the reference extension; title on hover shows the URL).
- Copy button in note head: `navigator.clipboard.write` with `text/html` (sanitized html) and `text/plain` (`htmlToText`); shows `Đã copy` for 1.2 s.

- [ ] **Step 1: Implement `editor.js`.**
- [ ] **Step 2: Manual check in the popup**: bold/italic/underline toggle and light up; color a word; Ctrl/Cmd+K inserts a link; click the link opens a new tab; paste a selection from a web page with bold + a link + an image → bold and link kept, image gone; copy button then paste into Google Docs keeps formatting.
- [ ] **Step 3: Commit** `feat: add rich text editor toolbar and paste handling`

### Task 8: Settings panel + sync status, end-to-end check

**Files:**
- Modify: `src/popup/popup.html`, `src/popup/popup.js`, `src/popup/popup.css`

**Interfaces:**
- Consumes: `saveConfig`, `testConnection`, `syncNow` messages; `syncStatus` storage key (Task 4).

Behavior (as mockup): gear opens full-panel settings (URL, password-type secret, `Lưu`, `Kiểm tra kết nối`, result line, Esc/back closes and returns focus). Test result text: success `✓ Kết nối được: <f> thư mục, <n> note`, failure `✗ <error>` in red. Status chip in header: `off` → grey dot `Chưa đồng bộ` (title `Chưa cấu hình Google Sheet`); `syncing` → `Đang đồng bộ…`; `idle` → `Đã đồng bộ`, title with `lastSyncAt` as `HH:mm`; `error` → red dot `Lỗi đồng bộ`, title = error text. Clicking the chip when in `error` triggers `syncNow`.

- [ ] **Step 1: Implement the settings panel and status chip.**
- [ ] **Step 2: End-to-end check with a real Sheet** following README: wrong secret shows `✗ Sai mã bí mật`; correct secret shows counts; edit a note → Sheet `Notes` row updates within ~3 s with `text` and `html`; rename folder → `Folders` row and `folder` column update; delete a note → `deleted` = TRUE.
- [ ] **Step 3: Second browser check**: load the extension in another Chrome profile, set the same URL + secret, open popup → same folders/notes, no extra `Folder 1` row in the Sheet. Edit in profile B, reopen popup in A → change visible.
- [ ] **Step 4: Offline check**: DevTools of the service worker → Network offline, edit a note → chip `Lỗi đồng bộ`; go online, wait ≤ 1 min (alarm) → `Đã đồng bộ` and Sheet updated.
- [ ] **Step 5: `npm test` passes. Commit** `feat: add sync settings and status indicator`
