// Sticky Notes Sync — Google Apps Script backend.
// Dán file này vào Google Sheet (Extensions → Apps Script), ĐỔI mã bí mật
// bên dưới, rồi Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). Xem README để biết từng bước.

const SECRET = 'CHANGE_ME'; // ← Đổi thành mã bí mật của bạn, giống mã nhập trong extension.

const FOLDER_COLUMNS = ['id', 'name', 'order', 'updatedAt', 'deleted', 'updated'];
const NOTE_COLUMNS = ['id', 'folderId', 'folder', 'order', 'text', 'html', 'updatedAt', 'deleted', 'updated'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!body || body.secret !== SECRET) return json_({ ok: false, error: 'unauthorized' });
  if (body.action !== 'sync') return json_({ ok: false, error: 'bad_request' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const folders = mergeRecords_(readFolders_(ss), body.folders || []);
    const notes = mergeRecords_(readNotes_(ss), body.notes || []);
    writeAll_(ss, folders, notes);
    return json_({ ok: true, folders: folders, notes: notes });
  } finally {
    lock.releaseLock();
  }
}

// Last-write-wins by updatedAt; ties keep the existing record.
// Must match mergeRemote in src/lib/merge.js.
function mergeRecords_(existing, incoming) {
  const byId = {};
  const order = [];
  existing.forEach(function (r) {
    byId[r.id] = r;
    order.push(r.id);
  });
  incoming.forEach(function (r) {
    if (!byId[r.id]) {
      order.push(r.id);
      byId[r.id] = r;
    } else if (r.updatedAt > byId[r.id].updatedAt) {
      byId[r.id] = r;
    }
  });
  return order.map(function (id) { return byId[id]; });
}

function sheet_(ss, name, columns) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rows_(ss, name, columns) {
  const values = sheet_(ss, name, columns).getDataRange().getValues();
  const header = values[0] || [];
  return values.slice(1).filter(function (row) { return row[0] !== ''; }).map(function (row) {
    const r = {};
    header.forEach(function (col, i) { r[col] = row[i]; });
    return r;
  });
}

// Sheets coerces cell types ("123" → 123, "TRUE" → true), so normalize on read.
const bool_ = function (v) { return v === true || String(v).toUpperCase() === 'TRUE'; };
const str_ = function (v) { return v === null || v === undefined ? '' : String(v); };
// A leading apostrophe stores the value as plain text: keeps "0912…" phone
// numbers intact and stops "=…" from becoming a formula. Sheets hides it on read.
const text_ = function (v) { return "'" + str_(v); };

function readFolders_(ss) {
  return rows_(ss, 'Folders', FOLDER_COLUMNS).map(function (r) {
    return { id: str_(r.id), name: str_(r.name), order: Number(r.order), updatedAt: Number(r.updatedAt), deleted: bool_(r.deleted) };
  });
}

function readNotes_(ss) {
  return rows_(ss, 'Notes', NOTE_COLUMNS).map(function (r) {
    return {
      id: str_(r.id), folderId: str_(r.folderId), order: Number(r.order),
      html: str_(r.html), text: str_(r.text), updatedAt: Number(r.updatedAt), deleted: bool_(r.deleted),
    };
  });
}

function writeAll_(ss, folders, notes) {
  const folderById = {};
  folders.forEach(function (f) { folderById[f.id] = f; });
  const folderOrder = function (n) { return folderById[n.folderId] ? folderById[n.folderId].order : Infinity; };

  const sortedFolders = folders.slice().sort(function (a, b) { return a.order - b.order; });
  const sortedNotes = notes.slice().sort(function (a, b) {
    return folderOrder(a) - folderOrder(b) || a.order - b.order;
  });

  write_(ss, 'Folders', FOLDER_COLUMNS, sortedFolders.map(function (f) {
    return [text_(f.id), text_(f.name), f.order, f.updatedAt, f.deleted, new Date(f.updatedAt)];
  }));
  write_(ss, 'Notes', NOTE_COLUMNS, sortedNotes.map(function (n) {
    const folder = folderById[n.folderId];
    return [text_(n.id), text_(n.folderId), text_(folder ? folder.name : ''), n.order, text_(n.text), text_(n.html), n.updatedAt, n.deleted, new Date(n.updatedAt)];
  }));
}

function write_(ss, name, columns, rows) {
  const sheet = sheet_(ss, name, columns);
  sheet.clearContents();
  const all = [columns].concat(rows);
  sheet.getRange(1, 1, all.length, columns.length).setValues(all);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
