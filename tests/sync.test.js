import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyMutation, liveFolders, DEFAULT_FOLDER_ID } from '../src/lib/model.js';
import { createSyncer } from '../src/lib/sync.js';
import { AuthRequired, DriveAccessMissing } from '../src/lib/google-auth.js';
import { SheetMissing, ApiError } from '../src/lib/sheets-store.js';
import { FOLDER_COLUMNS, NOTE_COLUMNS, TABS, parseTab } from '../src/lib/sheet-rows.js';

const edit = (s, id, html, now) => applyMutation(s, { type: 'editNote', id, html, text: html }, now).state;
const tick = () => new Promise(r => setImmediate(r));

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async key => (key in data ? { [key]: data[key] } : {}),
    set: async obj => Object.assign(data, obj),
    remove: async key => { delete data[key]; },
  };
}

// In-memory spreadsheets keyed by id; rows include the header.
function fakeStore() {
  const sheets = {};
  let next = 1;
  const store = {
    sheets,
    calls: [],
    gate: null,
    deleted: new Set(),
    async findOrCreate() {
      store.calls.push('findOrCreate');
      const existing = Object.keys(sheets).find(id => !store.deleted.has(id));
      if (existing) return { spreadsheetId: existing, created: false };
      const id = `S${next++}`;
      sheets[id] = { [TABS.folders]: [FOLDER_COLUMNS], [TABS.notes]: [NOTE_COLUMNS] };
      return { spreadsheetId: id, created: true };
    },
    async readAll(id) {
      store.calls.push(`readAll:${id}`);
      if (store.gate) await store.gate;
      if (!sheets[id] || store.deleted.has(id)) throw new SheetMissing('gone');
      const f = parseTab(sheets[id][TABS.folders], 'folders');
      const n = parseTab(sheets[id][TABS.notes], 'notes');
      return { folders: f.records, notes: n.records, rowIndex: { folders: f.rowById, notes: n.rowById } };
    },
    async write(id, plan) {
      store.calls.push(`write:${id}`);
      store.lastPlan = plan;
      for (const u of plan.updates) {
        const [, tab, row] = u.range.match(/^(\w+)!A(\d+):/);
        sheets[id][tab][Number(row) - 1] = u.values[0];
      }
      for (const [tab, rows] of Object.entries(plan.appends)) sheets[id][tab].push(...rows);
    },
    url: id => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  };
  return store;
}

function fakeAuth({ account = { email: 'a@x.com' }, signInEmail = 'a@x.com' } = {}) {
  const auth = {
    account,
    tokenError: null,
    signInError: null,
    signedOut: 0,
    getAccount: async () => auth.account,
    getToken: async () => { if (auth.tokenError) throw auth.tokenError; return 'T'; },
    signInCalls: [],
    signIn: async opts => { auth.signInCalls.push(opts); if (auth.signInError) throw auth.signInError; return { email: signInEmail, token: 'T' }; },
    signOut: async () => { auth.signedOut++; auth.account = null; },
    invalidate: async () => {},
  };
  return auth;
}

function harness({ state = defaultState(), auth = fakeAuth(), store = fakeStore(), local = {} } = {}) {
  const h = { state, status: {}, auth, store };
  h.local = memoryArea(local);
  // The syncer stores the account itself; mirror it into the fake auth.
  const set = h.local.set;
  h.local.set = async obj => { if (obj.account) auth.account = obj.account; return set(obj); };
  h.syncer = createSyncer({
    readState: async () => h.state,
    updateState: async fn => (h.state = fn(h.state)),
    setStatus: async patch => { h.status = { ...h.status, ...patch }; },
    auth,
    store,
    local: h.local,
    now: () => 4242,
  });
  return h;
}

const noteRows = (h, id = 'S1') => h.store.sheets[id][TABS.notes].slice(1);

test('pushes dirty records as row writes and clears dirty', async () => {
  const h = harness({ state: edit(defaultState(), 'default-n1', 'hello', 5) });
  await h.syncer.syncOnce();
  assert.equal(h.local.data.sheet.spreadsheetId, 'S1');
  assert.ok(noteRows(h).some(r => r[0] === 'default-n1' && r[5] === 'hello'));
  assert.deepEqual(h.state.dirty, {});
  assert.deepEqual(h.status, { status: 'idle', lastSyncAt: 4242, error: null, tooLong: [] });

  // A later edit updates that row in place instead of appending.
  const rows = noteRows(h).length;
  h.state = edit(h.state, 'default-n1', 'again', 6);
  await h.syncer.syncOnce();
  assert.equal(noteRows(h).length, rows);
  assert.deepEqual(h.store.lastPlan.updates.map(u => u.range), ['Notes!A2:I2']);
});

test('keeps edits made during an in-flight sync dirty', async () => {
  // The user types while the round is writing 'old' to the sheet.
  const h2 = harness({ state: edit(defaultState(), 'default-n1', 'old', 5) });
  const write = h2.store.write;
  h2.store.write = async (id, plan) => { h2.state = edit(h2.state, 'default-n1', 'newer', 7); return write(id, plan); };
  await h2.syncer.syncOnce();
  assert.equal(h2.state.notes['default-n1'].html, 'newer');
  assert.ok(h2.state.dirty['default-n1']);
  assert.ok(noteRows(h2).some(r => r[5] === 'old'));
});

test('pulls remote records before writing', async () => {
  const store = fakeStore();
  const a = harness({ store, state: edit(defaultState(), 'default-n1', 'from A', 5) });
  await a.syncer.syncOnce();
  const b = harness({ store });
  await b.syncer.syncOnce();
  assert.equal(b.state.notes['default-n1'].html, 'from A');
  assert.equal(store.calls.filter(c => c === 'findOrCreate').length, 2);
  assert.equal(Object.keys(store.sheets).length, 1);
});

test('two devices do not overwrite each other', async () => {
  const store = fakeStore();
  const a = harness({ store, state: edit(defaultState(), 'default-n1', 'A1', 5) });
  await a.syncer.syncOnce();
  const b = harness({ store });
  await b.syncer.syncOnce();
  a.state = edit(a.state, 'default-n1', 'A2', 10);
  b.state = edit(b.state, 'default-n2', 'B2', 11);
  await a.syncer.syncOnce();
  await b.syncer.syncOnce();
  const byId = Object.fromEntries(noteRows(a).map(r => [r[0], r[5]]));
  assert.equal(byId['default-n1'], 'A2');
  assert.equal(byId['default-n2'], 'B2');
});

test('new spreadsheet marks everything dirty', async () => {
  // Already-synced local data (not dirty) must still reach a brand-new sheet.
  let s = edit(defaultState(), 'default-n1', 'x', 5);
  s = { ...s, dirty: {} };
  const h = harness({ state: s });
  await h.syncer.syncOnce();
  assert.ok(noteRows(h).some(r => r[0] === 'default-n1' && r[5] === 'x'));
  assert.ok(h.store.sheets.S1[TABS.folders].some(r => r[0] === DEFAULT_FOLDER_ID));
});

test('missing sheet recreates and pushes all', async () => {
  const h = harness({ state: edit(defaultState(), 'default-n1', 'keep me', 5) });
  await h.syncer.syncOnce();
  h.store.deleted.add('S1');
  await h.syncer.syncOnce();
  assert.equal(h.local.data.sheet.spreadsheetId, 'S2');
  assert.ok(noteRows(h, 'S2').some(r => r[5] === 'keep me'));
  assert.equal(h.status.status, 'idle');
});

test('auth required keeps dirty and sets signin', async () => {
  const h = harness({ state: edit(defaultState(), 'default-n1', 'x', 5) });
  h.auth.tokenError = new AuthRequired('interaction_required');
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'signin');
  assert.equal(h.status.error, 'Please sign in again');
  assert.ok(h.state.dirty['default-n1']);
  assert.equal(h.store.calls.length, 0);
});

test("network failure maps to Can't reach Google", async () => {
  const h = harness({ state: edit(defaultState(), 'default-n1', 'x', 5) });
  h.store.findOrCreate = async () => { throw new TypeError('Failed to fetch'); };
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'error');
  assert.equal(h.status.error, "Can't reach Google");
  assert.ok(h.state.dirty['default-n1']);

  const api = harness();
  api.store.findOrCreate = async () => { throw new ApiError(503); };
  await api.syncer.syncOnce();
  assert.equal(api.status.error, 'Google returned an error (503)');
});

test('signed out sets status off without network', async () => {
  const h = harness({ auth: fakeAuth({ account: null }) });
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'off');
  assert.equal(h.store.calls.length, 0);
});

test('concurrent calls coalesce', async () => {
  const h = harness();
  let release;
  h.store.gate = new Promise(r => { release = r; });
  const runs = [h.syncer.syncOnce(), h.syncer.syncOnce(), h.syncer.syncOnce()];
  await tick();
  release();
  h.store.gate = null;
  await Promise.all(runs);
  assert.equal(h.store.calls.filter(c => c.startsWith('readAll')).length, 2);
});

test('signIn stores the account and syncs', async () => {
  const h = harness({ auth: fakeAuth({ account: null }) });
  assert.deepEqual(await h.syncer.signIn(), { ok: true, email: 'a@x.com' });
  assert.deepEqual(h.local.data.account, { email: 'a@x.com' });
  assert.equal(h.local.data.lastEmail, 'a@x.com');
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'idle');
});

test('signIn with different account needs confirmation', async () => {
  const h = harness({
    auth: fakeAuth({ account: null, signInEmail: 'b@x.com' }),
    state: edit(defaultState(), 'default-n1', 'private', 5),
    local: { lastEmail: 'a@x.com', sheet: { spreadsheetId: 'S9', email: 'a@x.com' } },
  });
  assert.deepEqual(await h.syncer.signIn(), { ok: false, needsConfirm: true, email: 'b@x.com', previousEmail: 'a@x.com' });
  assert.equal(h.local.data.account, undefined);
  assert.deepEqual(await h.syncer.confirmSignIn(), { ok: true, email: 'b@x.com' });
  assert.deepEqual(h.local.data.account, { email: 'b@x.com' });
  assert.equal(h.local.data.sheet, undefined);

  // No local notes -> no question.
  const empty = harness({ auth: fakeAuth({ account: null, signInEmail: 'b@x.com' }), local: { lastEmail: 'a@x.com' } });
  assert.equal((await empty.syncer.signIn()).ok, true);
});

test('cancelSignIn signs out', async () => {
  const h = harness({
    auth: fakeAuth({ account: null, signInEmail: 'b@x.com' }),
    state: edit(defaultState(), 'default-n1', 'private', 5),
    local: { lastEmail: 'a@x.com' },
  });
  await h.syncer.signIn();
  assert.deepEqual(await h.syncer.cancelSignIn(), { ok: true });
  assert.equal(h.auth.signedOut, 1);
  assert.equal(h.local.data.account, undefined);
  assert.deepEqual(await h.syncer.confirmSignIn(), { ok: false, error: 'Nothing to confirm' });
});

test('cancelled Google sign-in reports an error', async () => {
  const h = harness({ auth: fakeAuth({ account: null }) });
  h.auth.signInError = new AuthRequired('The user did not approve access.');
  assert.deepEqual(await h.syncer.signIn(), { ok: false, error: 'Sign-in was cancelled' });
});

test('signOut keeps or removes notes', async () => {
  const keep = harness({ state: edit(defaultState(), 'default-n1', 'x', 5), local: { sheet: { spreadsheetId: 'S1', email: 'a@x.com' } } });
  await keep.syncer.signOut(true);
  assert.equal(keep.auth.signedOut, 1);
  assert.equal(keep.local.data.sheet, undefined);
  assert.equal(keep.state.notes['default-n1'].html, 'x');
  assert.equal(keep.status.status, 'off');

  const remove = harness({ state: edit(defaultState(), 'default-n1', 'x', 5) });
  await remove.syncer.signOut(false);
  assert.deepEqual(remove.state, defaultState());
  assert.equal(liveFolders(remove.state).length, 1);
});

test('pending sign-in is reported until answered', async () => {
  const h = harness({
    auth: fakeAuth({ account: null, signInEmail: 'b@x.com' }),
    state: edit(defaultState(), 'default-n1', 'private', 5),
    local: { lastEmail: 'a@x.com' },
  });
  assert.equal(h.syncer.pendingSignIn(), null);
  await h.syncer.signIn();
  assert.deepEqual(h.syncer.pendingSignIn(), { email: 'b@x.com', previousEmail: 'a@x.com' });
  await h.syncer.cancelSignIn();
  assert.equal(h.syncer.pendingSignIn(), null);
});

test('missing Drive access during sync sets status drive and keeps dirty', async () => {
  const h = harness({ state: edit(defaultState(), 'default-n1', 'x', 5) });
  h.store.readAll = async () => { throw new DriveAccessMissing('no scope'); };
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'drive');
  assert.equal(h.status.error, 'Allow Google Drive access to sync');
  assert.ok(h.state.dirty['default-n1']);
});

test('signIn without Drive access asks to try again', async () => {
  const h = harness({ auth: fakeAuth({ account: null }) });
  h.auth.signInError = new DriveAccessMissing('no scope');
  assert.deepEqual(await h.syncer.signIn(), { ok: false, needsDrive: true });
  assert.equal(h.local.data.account, undefined);

  h.auth.signInError = null;
  assert.deepEqual(await h.syncer.signIn({ forceConsent: true }), { ok: true, email: 'a@x.com' });
  assert.deepEqual(h.auth.signInCalls.at(-1), { forceConsent: true });
});
