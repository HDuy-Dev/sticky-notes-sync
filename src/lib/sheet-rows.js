// Pure conversion between sheet rows and records, plus planning which rows
// a sync round writes. Only rows this device changed are ever written, so
// two devices syncing at once never overwrite each other's rows.

export const FOLDER_COLUMNS = ['id', 'name', 'order', 'updatedAt', 'deleted', 'updated'];
export const NOTE_COLUMNS = ['id', 'folderId', 'folder', 'order', 'text', 'html', 'updatedAt', 'deleted', 'updated'];
export const TABS = { folders: 'Folders', notes: 'Notes' };

const COLUMNS = { folders: FOLDER_COLUMNS, notes: NOTE_COLUMNS };
const lastColumn = kind => String.fromCharCode(64 + COLUMNS[kind].length);

const str = v => (v === null || v === undefined ? '' : String(v));
const num = v => Number(v) || 0;
const bool = v => v === true || String(v).toUpperCase() === 'TRUE';

function toRecord(kind, cell) {
  if (kind === 'folders') {
    return { id: str(cell.id), name: str(cell.name), order: num(cell.order), updatedAt: num(cell.updatedAt), deleted: bool(cell.deleted) };
  }
  return {
    id: str(cell.id), folderId: str(cell.folderId), order: num(cell.order),
    text: str(cell.text), html: str(cell.html), updatedAt: num(cell.updatedAt), deleted: bool(cell.deleted),
  };
}

// values[0] is the header row; returned row numbers are 1-based sheet rows.
export function parseTab(values, kind) {
  const byId = {};
  const rowById = {};
  (values || []).slice(1).forEach((row, i) => {
    const cell = {};
    COLUMNS[kind].forEach((col, c) => { cell[col] = row?.[c]; });
    const record = toRecord(kind, cell);
    if (!record.id) return;
    // A retried append can leave duplicate rows; the newest one wins.
    if (!byId[record.id] || record.updatedAt > byId[record.id].updatedAt) {
      byId[record.id] = record;
      rowById[record.id] = i + 2;
    }
  });
  return { records: Object.values(byId), rowById };
}

const iso = ms => new Date(ms).toISOString();

export function folderRow(f) {
  return [f.id, f.name, f.order, f.updatedAt, f.deleted, iso(f.updatedAt)];
}

export function noteRow(n, folderName) {
  return [n.id, n.folderId, folderName, n.order, n.text, n.html, n.updatedAt, n.deleted, iso(n.updatedAt)];
}

export function planWrites(changes, rowIndex, state) {
  const plan = { updates: [], appends: { [TABS.folders]: [], [TABS.notes]: [] } };
  const changedFolders = new Map(changes.folders.map(f => [f.id, f]));
  const folderName = id => (changedFolders.get(id) || state.folders[id])?.name ?? '';

  const notes = new Map(changes.notes.map(n => [n.id, n]));
  // A renamed folder's notes carry the folder name, so rewrite those rows too.
  for (const folder of changes.folders) {
    for (const n of Object.values(state.notes)) {
      if (n.folderId === folder.id && !n.deleted && !notes.has(n.id)) notes.set(n.id, n);
    }
  }

  const add = (kind, record, row) => {
    const at = rowIndex[kind]?.[record.id];
    if (at) plan.updates.push({ range: `${TABS[kind]}!A${at}:${lastColumn(kind)}${at}`, values: [row] });
    else plan.appends[TABS[kind]].push(row);
  };
  for (const f of changes.folders) add('folders', f, folderRow(f));
  for (const n of notes.values()) add('notes', n, noteRow(n, folderName(n.folderId)));
  return plan;
}
