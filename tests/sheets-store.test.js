import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsStore, SheetMissing, ApiError } from '../src/lib/sheets-store.js';
import { FOLDER_COLUMNS, NOTE_COLUMNS } from '../src/lib/sheet-rows.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

// routes: [predicate(url, init) => response | undefined]
function harness(route) {
  const h = { calls: [], tokens: ['T1', 'T2'], invalidated: 0 };
  h.store = createSheetsStore({
    fetchFn: async (url, init = {}) => {
      h.calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
      return route(url, init, h.calls.length) || json({ error: 'unrouted' }, 500);
    },
    getToken: async () => h.tokens[h.invalidated] || 'T?',
    onUnauthorized: async () => { h.invalidated++; },
  });
  return h;
}

test('findOrCreate reuses existing file', async () => {
  const h = harness(url => (url.startsWith('https://www.googleapis.com/drive/v3/files?') ? json({ files: [{ id: 'S1' }, { id: 'S2' }] }) : undefined));
  assert.deepEqual(await h.store.findOrCreate(), { spreadsheetId: 'S1', created: false });
  const q = new URL(h.calls[0].url).searchParams;
  assert.equal(q.get('q'), "appProperties has { key='stickyNotesSync' and value='v1' } and trashed=false");
  assert.equal(q.get('orderBy'), 'createdTime');
  assert.equal(h.calls[0].auth, 'Bearer T1');
});

test('findOrCreate creates spreadsheet with tabs and headers', async () => {
  const h = harness((url, init) => {
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return json({ files: [] });
    if (url === 'https://www.googleapis.com/drive/v3/files' && init.method === 'POST') return json({ id: 'NEW' });
    if (url.endsWith('/spreadsheets/NEW:batchUpdate')) return json({});
    if (url.includes('/spreadsheets/NEW/values:batchUpdate')) return json({});
  });
  assert.deepEqual(await h.store.findOrCreate(), { spreadsheetId: 'NEW', created: true });
  assert.deepEqual(h.calls[1].body, {
    name: 'Sticky Notes Sync',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    appProperties: { stickyNotesSync: 'v1' },
  });
  const requests = h.calls[2].body.requests;
  assert.deepEqual(requests.map(r => r.addSheet?.properties.title ?? (r.deleteSheet && 'delete')), ['Folders', 'Notes', 'delete']);
  assert.deepEqual(requests[2].deleteSheet, { sheetId: 0 });
  assert.deepEqual(h.calls[3].body, {
    valueInputOption: 'RAW',
    data: [{ range: 'Folders!A1', values: [FOLDER_COLUMNS] }, { range: 'Notes!A1', values: [NOTE_COLUMNS] }],
  });
});

test('readAll parses both tabs', async () => {
  const h = harness(url => {
    if (url.includes('/spreadsheets/S/values:batchGet')) {
      return json({ valueRanges: [
        { values: [FOLDER_COLUMNS, ['f', 'Work', 0, 5, false]] },
        { values: [NOTE_COLUMNS, ['n', 'f', 'Work', 0, 't', 'h', 6, false]] },
      ] });
    }
  });
  const all = await h.store.readAll('S');
  const u = new URL(h.calls[0].url);
  assert.deepEqual(u.searchParams.getAll('ranges'), ['Folders!A:F', 'Notes!A:I']);
  assert.equal(u.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
  assert.deepEqual(all.folders.map(f => f.name), ['Work']);
  assert.deepEqual(all.notes.map(n => n.html), ['h']);
  assert.deepEqual(all.rowIndex, { folders: { f: 2 }, notes: { n: 2 } });
});

test('readAll on missing sheet throws SheetMissing', async () => {
  const h = harness(() => json({ error: { code: 404 } }, 404));
  await assert.rejects(h.store.readAll('GONE'), SheetMissing);
  const other = harness(() => json({ error: { code: 500 } }, 500));
  await assert.rejects(other.store.readAll('S'), err => err instanceof ApiError && err.status === 500);
});

test('401 refreshes token once then retries', async () => {
  const h = harness((url, init, n) => (n === 1 ? json({}, 401) : json({ files: [{ id: 'S1' }] })));
  assert.equal((await h.store.findOrCreate()).spreadsheetId, 'S1');
  assert.deepEqual(h.calls.map(c => c.auth), ['Bearer T1', 'Bearer T2']);
  assert.equal(h.invalidated, 1);

  const always = harness(() => json({}, 401));
  await assert.rejects(always.store.findOrCreate(), err => err instanceof ApiError && err.status === 401);
  assert.equal(always.calls.length, 2);
});

test('write sends one batchUpdate and per-tab appends, RAW', async () => {
  const h = harness(() => json({}));
  await h.store.write('S', {
    updates: [{ range: 'Notes!A2:I2', values: [['n']] }, { range: 'Folders!A3:F3', values: [['f']] }],
    appends: { Folders: [], Notes: [['a'], ['b']] },
  });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://sheets.googleapis.com/v4/spreadsheets/S/values:batchUpdate');
  assert.deepEqual(h.calls[0].body, {
    valueInputOption: 'RAW',
    data: [{ range: 'Notes!A2:I2', values: [['n']] }, { range: 'Folders!A3:F3', values: [['f']] }],
  });
  const append = new URL(h.calls[1].url);
  assert.equal(append.pathname, '/v4/spreadsheets/S/values/Notes!A1:append');
  assert.equal(append.searchParams.get('valueInputOption'), 'RAW');
  assert.equal(append.searchParams.get('insertDataOption'), 'INSERT_ROWS');
  assert.deepEqual(h.calls[1].body, { values: [['a'], ['b']] });
});

test('write with empty plan sends nothing', async () => {
  const h = harness(() => json({}));
  await h.store.write('S', { updates: [], appends: { Folders: [], Notes: [] } });
  assert.equal(h.calls.length, 0);
});

test('url points at the sheet', () => {
  const h = harness(() => undefined);
  assert.equal(h.store.url('S'), 'https://docs.google.com/spreadsheets/d/S/edit');
});
