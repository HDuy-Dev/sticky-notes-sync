import { MAX_NOTES, liveFolders, liveNotes, newId } from '../lib/model.js';
import { sanitizeHtml, htmlToText } from '../lib/sanitize.js';
import { initEditor } from './editor.js';

const SAVE_DELAY_MS = 300;
const $ = id => document.getElementById(id);
const send = msg => chrome.runtime.sendMessage(msg);
const icon = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON_PEN = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>';
const ICON_COPY = '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';
const ICON_TRASH = '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>';

let state = null;
let status = { status: 'off', tooLong: [] };
let activeId = null;
let renamingId = null;
const noteEls = new Map(); // note id -> element, reused across renders
const pendingSaves = new Map(); // note id -> timer

const editor = initEditor({ toolbarEl: $('toolbar'), onNoteInput: body => queueSave(body) });

function announce(msg) {
  $('live').textContent = msg;
}

function storeActive(id) {
  try { localStorage.setItem('activeFolder', id); } catch {}
}

function loadActive() {
  try { return localStorage.getItem('activeFolder'); } catch { return null; }
}

async function mutate(mutation) {
  const res = await send({ type: 'mutate', mutation });
  if (!res?.ok) announce('Không thực hiện được thao tác');
  return res;
}

// ---- Saving note edits --------------------------------------------------

function queueSave(body) {
  const id = body.dataset.id;
  clearTimeout(pendingSaves.get(id));
  pendingSaves.set(id, setTimeout(() => flushSave(id), SAVE_DELAY_MS));
}

function flushSave(id) {
  clearTimeout(pendingSaves.get(id));
  pendingSaves.delete(id);
  const body = noteEls.get(id)?.querySelector('.body');
  if (!body) return;
  const html = sanitizeHtml(body.innerHTML);
  send({ type: 'mutate', mutation: { type: 'editNote', id, html, text: htmlToText(html) } });
}

function flushAll() {
  for (const id of [...pendingSaves.keys()]) flushSave(id);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
window.addEventListener('pagehide', flushAll);

// ---- Folders ------------------------------------------------------------

function currentFolders() {
  return liveFolders(state);
}

function ensureActive() {
  const folders = currentFolders();
  if (!folders.some(f => f.id === activeId)) activeId = folders[0]?.id ?? null;
}

function selectFolder(id) {
  if (id === activeId) return;
  flushAll();
  activeId = id;
  storeActive(id);
  closeFolderConfirm(false);
  editor.reset();
  render();
}

function startRename(id) {
  renamingId = id;
  renderTabs();
}

function renderTabs() {
  const tabs = $('tabs');
  const folders = currentFolders();
  tabs.textContent = '';
  for (const f of folders) {
    const wrap = document.createElement('div');
    wrap.className = 'tab' + (f.id === activeId ? ' active' : '');

    if (f.id === renamingId) {
      const input = document.createElement('input');
      input.value = f.name;
      input.maxLength = 30;
      input.setAttribute('aria-label', 'Tên thư mục');
      let closed = false;
      const done = save => {
        if (closed) return;
        closed = true;
        renamingId = null;
        const name = input.value.trim();
        if (save && name && name !== f.name) mutate({ type: 'renameFolder', id: f.id, name });
        renderTabs();
        tabs.querySelector('.active .name')?.focus();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
      wrap.append(input);
      tabs.append(wrap);
      input.focus();
      input.select();
      continue;
    }

    const name = document.createElement('button');
    name.className = 'name';
    name.textContent = f.name;
    name.setAttribute('role', 'tab');
    name.setAttribute('aria-selected', String(f.id === activeId));
    name.tabIndex = f.id === activeId ? 0 : -1;
    name.title = f.id === activeId ? 'Nhấp đúp để đổi tên' : f.name;
    name.addEventListener('click', () => selectFolder(f.id));
    name.addEventListener('dblclick', () => startRename(f.id));
    name.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = folders.indexOf(f);
        const next = folders[(i + (e.key === 'ArrowRight' ? 1 : -1) + folders.length) % folders.length];
        selectFolder(next.id);
        tabs.querySelector('.active .name')?.focus();
      }
      if (e.key === 'F2') startRename(f.id);
    });

    const rename = document.createElement('button');
    rename.className = 'rename';
    rename.title = 'Đổi tên (F2)';
    rename.setAttribute('aria-label', `Đổi tên thư mục ${f.name}`);
    rename.innerHTML = icon(ICON_PEN);
    rename.addEventListener('click', () => startRename(f.id));

    wrap.append(name, rename);
    tabs.append(wrap);
  }
  tabs.querySelector('.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });

  const onlyOne = folders.length <= 1;
  $('delFolder').disabled = onlyOne;
  $('delFolder').title = onlyOne ? 'Cần giữ ít nhất 1 thư mục' : 'Xóa thư mục đang chọn';
}

$('addFolder').addEventListener('click', async () => {
  const id = newId();
  activeId = id;
  storeActive(id);
  renamingId = id;
  editor.reset();
  await mutate({ type: 'addFolder', id, name: `Folder ${currentFolders().length + 1}`, noteIds: [newId(), newId()] });
});

$('delFolder').addEventListener('click', () => {
  const folder = state.folders[activeId];
  if (!folder || currentFolders().length <= 1) return;
  const count = liveNotes(state, activeId).length;
  $('folderConfirmText').textContent = `Xóa thư mục "${folder.name}" và ${count} note bên trong? Không thể hoàn tác.`;
  $('folderConfirm').classList.add('show');
  $('folderCancel').focus();
});

function closeFolderConfirm(restoreFocus = true) {
  $('folderConfirm').classList.remove('show');
  if (restoreFocus) $('delFolder').focus();
}

$('folderCancel').addEventListener('click', () => closeFolderConfirm());
$('folderConfirm').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeFolderConfirm();
});
$('folderOk').addEventListener('click', async () => {
  const folders = currentFolders();
  const i = folders.findIndex(f => f.id === activeId);
  const name = folders[i]?.name;
  const nextId = (folders[i - 1] || folders[i + 1])?.id;
  closeFolderConfirm(false);
  const res = await mutate({ type: 'deleteFolder', id: activeId });
  if (res?.ok) {
    selectFolder(nextId);
    announce(`Đã xóa thư mục ${name}`);
  }
});

// ---- Notes --------------------------------------------------------------

function buildNote(note) {
  const el = document.createElement('div');
  el.className = 'note';

  const head = document.createElement('div');
  head.className = 'note-head';
  const label = document.createElement('span');
  label.className = 'label';
  const copied = document.createElement('span');
  copied.className = 'copied';
  copied.textContent = 'Đã copy';
  copied.hidden = true;
  const copy = document.createElement('button');
  copy.className = 'act copy';
  copy.title = 'Copy toàn bộ note';
  copy.innerHTML = icon(ICON_COPY);
  const del = document.createElement('button');
  del.className = 'act del';
  del.title = 'Xóa note';
  del.innerHTML = icon(ICON_TRASH);
  head.append(label, copied, copy, del);

  const tooLong = document.createElement('div');
  tooLong.className = 'too-long';
  tooLong.textContent = 'Note quá dài (>45.000 ký tự), không đồng bộ được lên Sheet.';
  tooLong.hidden = true;

  const body = document.createElement('div');
  body.className = 'body';
  body.contentEditable = 'true';
  body.dataset.id = note.id;
  body.setAttribute('role', 'textbox');
  body.setAttribute('aria-multiline', 'true');
  body.innerHTML = sanitizeHtml(note.html);
  body.addEventListener('input', () => queueSave(body));
  editor.attach(body);

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.innerHTML = '<div>Xóa note này?</div><div class="row"><button class="btn">Hủy</button><button class="btn danger">Xóa</button></div>';
  const [cancel, ok] = overlay.querySelectorAll('button');
  const closeOverlay = () => { overlay.classList.remove('show'); del.focus(); };
  del.addEventListener('click', () => { overlay.classList.add('show'); cancel.focus(); });
  cancel.addEventListener('click', closeOverlay);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });
  ok.addEventListener('click', async () => {
    clearTimeout(pendingSaves.get(note.id));
    pendingSaves.delete(note.id);
    const res = await mutate({ type: 'deleteNote', id: note.id });
    if (res?.ok) announce('Đã xóa note');
  });

  copy.addEventListener('click', async () => {
    await editor.copy(body);
    copied.hidden = false;
    announce('Đã copy note');
    setTimeout(() => { copied.hidden = true; }, 1200);
  });

  el.append(head, tooLong, body, overlay);
  return el;
}

function updateNote(el, note, index) {
  const n = index + 1;
  el.querySelector('.label').textContent = `Note ${n}`;
  el.querySelector('.copy').setAttribute('aria-label', `Copy note ${n}`);
  el.querySelector('.del').setAttribute('aria-label', `Xóa note ${n}`);
  el.querySelector('.too-long').hidden = !status.tooLong?.includes(note.id);
  const body = el.querySelector('.body');
  body.setAttribute('aria-label', `Nội dung note ${n}`);
  // Never overwrite what the user is typing or has not saved yet.
  if (document.activeElement === body || pendingSaves.has(note.id)) return;
  const html = sanitizeHtml(note.html);
  if (body.innerHTML !== html) body.innerHTML = html;
}

function renderGrid() {
  const grid = $('grid');
  const notes = activeId ? liveNotes(state, activeId) : [];
  const keep = new Set(notes.map(n => n.id));

  for (const [id, el] of noteEls) {
    if (!keep.has(id)) {
      el.remove();
      noteEls.delete(id);
    }
  }
  grid.querySelector('.empty-folder')?.remove();

  notes.forEach((note, i) => {
    let el = noteEls.get(note.id);
    if (!el) {
      el = buildNote(note);
      noteEls.set(note.id, el);
    }
    updateNote(el, note, i);
    // Only move nodes that are out of place so a focused note keeps focus.
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
  });

  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-folder';
    empty.innerHTML = '<b>Thư mục trống</b><span>Bấm "Thêm note" để bắt đầu ghi chú.</span>';
    grid.append(empty);
  }
  grid.style.setProperty('--cols', Math.max(notes.length, 1));

  const full = notes.length >= MAX_NOTES;
  $('addNote').disabled = full;
  $('addNoteText').textContent = full ? `Đủ ${MAX_NOTES}/${MAX_NOTES} note` : `Thêm note (${notes.length}/${MAX_NOTES})`;
  $('addNote').title = full ? `Mỗi thư mục tối đa ${MAX_NOTES} note` : '';
}

let focusNoteId = null;
$('addNote').addEventListener('click', async () => {
  if (liveNotes(state, activeId).length >= MAX_NOTES) return;
  const id = newId();
  focusNoteId = id;
  await mutate({ type: 'addNote', id, folderId: activeId });
});

// ---- Render -------------------------------------------------------------

function render() {
  ensureActive();
  // Rebuilding tabs mid-rename would discard what the user is typing.
  const renameInput = $('tabs').querySelector('input');
  if (!renameInput || document.activeElement !== renameInput) renderTabs();
  renderGrid();
  if (focusNoteId && noteEls.has(focusNoteId)) {
    noteEls.get(focusNoteId).querySelector('.body').focus();
    focusNoteId = null;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.syncStatus) status = changes.syncStatus.newValue || status;
  if (changes.state?.newValue) state = changes.state.newValue;
  if (state && (changes.state || changes.syncStatus)) render();
});

async function init() {
  const res = await send({ type: 'getState' });
  state = res.state;
  status = res.status;
  activeId = loadActive();
  render();
  send({ type: 'syncNow' });
}

init();
