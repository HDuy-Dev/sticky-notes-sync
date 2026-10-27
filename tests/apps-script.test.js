import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

// Minimal in-memory Spreadsheet: sheets are arrays of rows.
function fakeSpreadsheet() {
  const sheets = {};
  // Emulates Sheets cell coercion: numeric text → number, "=..." → formula,
  // and a leading apostrophe forces text (and is hidden on read).
  const store = v => {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return { text: v.slice(1) };
    if (v.startsWith('=')) return { formula: v };
    if (v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return v;
  };
  const read = v => (v && typeof v === 'object' && 'text' in v ? v.text : v && v.formula ? '#ERROR!' : v);
  const sheet = name => ({
    getDataRange: () => ({ getValues: () => sheets[name].map(r => r.map(read)) }),
    clearContents: () => { sheets[name] = []; },
    getRange: (row, col, nRows, nCols) => ({
      setValues: values => {
        for (let i = 0; i < nRows; i++) sheets[name][row - 1 + i] = values[i].slice(0, nCols).map(store);
      },
    }),
    setFrozenRows: () => {},
  });
  return {
    sheets,
    api: {
      getSheetByName: name => (sheets[name] ? sheet(name) : null),
      insertSheet: name => { sheets[name] = []; return sheet(name); },
    },
  };
}

function load() {
  const ss = fakeSpreadsheet();
  const sandbox = {
    Date,
    JSON,
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss.api },
  };
  vm.runInNewContext(source.replace("const SECRET = 'CHANGE_ME';", "const SECRET = 'pw';"), sandbox);
  const post = body => JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  // vm arrays have another realm's prototype; copy into this realm for deepEqual.
  const merge = (a, b) => JSON.parse(JSON.stringify(sandbox.mergeRecords_(a, b)));
  return { sandbox, ss, post, merge };
}

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });

test('newer incoming replaces existing', () => {
  const { merge } = load();
  const out = merge([rec('a', 1, { v: 'old' })], [rec('a', 2, { v: 'new' })]);
  assert.deepEqual(out.map(r => r.v), ['new']);
});

test('older incoming ignored', () => {
  const { merge } = load();
  const out = merge([rec('a', 5, { v: 'keep' })], [rec('a', 2, { v: 'old' })]);
  assert.deepEqual(out.map(r => r.v), ['keep']);
});

test('tie keeps existing', () => {
  const { merge } = load();
  const out = merge([rec('a', 5, { v: 'existing' })], [rec('a', 5, { v: 'incoming' })]);
  assert.deepEqual(out.map(r => r.v), ['existing']);
});

test('new ids appended', () => {
  const { merge } = load();
  const out = merge([rec('a', 1)], [rec('b', 1)]);
  assert.deepEqual(out.map(r => r.id), ['a', 'b']);
});

test('doPost rejects wrong secret', () => {
  const { post } = load();
  assert.deepEqual(post({ secret: 'x', action: 'sync', folders: [], notes: [] }), { ok: false, error: 'unauthorized' });
});

test('doPost rejects unknown action and bad JSON', () => {
  const { sandbox, post } = load();
  assert.deepEqual(post({ secret: 'pw', action: 'nope' }), { ok: false, error: 'bad_request' });
  assert.deepEqual(JSON.parse(sandbox.doPost({ postData: { contents: '{' } }).text), { ok: false, error: 'bad_request' });
});

test('sync writes readable rows and round-trips records with correct types', () => {
  const { ss, post } = load();
  const folder = { id: 'f', name: 'Work', order: 0, updatedAt: 1700000000000, deleted: false };
  const note = { id: 'n', folderId: 'f', order: 1, html: '<b>123</b>', text: '123', updatedAt: 1700000000001, deleted: false };
  const first = post({ secret: 'pw', action: 'sync', folders: [folder], notes: [note] });
  assert.equal(first.ok, true);
  assert.deepEqual(Array.from(ss.sheets.Folders[0], c => c.text ?? c), ['id', 'name', 'order', 'updatedAt', 'deleted', 'updated']);
  assert.deepEqual(Array.from(ss.sheets.Notes[0], c => c.text ?? c), ['id', 'folderId', 'folder', 'order', 'text', 'html', 'updatedAt', 'deleted', 'updated']);
  assert.equal(ss.sheets.Notes[1][2].text, 'Work');
  const again = post({ secret: 'pw', action: 'sync', folders: [], notes: [] });
  assert.deepEqual(again.folders, [folder]);
  assert.deepEqual(again.notes, [note]);
});

test('phone numbers and formulas survive as plain text', () => {
  const { post } = load();
  const notes = [
    { id: 'p', folderId: 'f', order: 0, html: '0912345678', text: '0912345678', updatedAt: 1, deleted: false },
    { id: 'q', folderId: 'f', order: 1, html: '=1+1', text: '=1+1', updatedAt: 1, deleted: false },
  ];
  post({ secret: 'pw', action: 'sync', folders: [], notes });
  assert.deepEqual(post({ secret: 'pw', action: 'sync', folders: [], notes: [] }).notes, notes);
});
