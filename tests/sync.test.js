import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyMutation } from '../src/lib/model.js';
import { createSyncer } from '../src/lib/sync.js';

const CONFIG = { url: 'https://script.google.com/macros/s/x/exec', secret: 's3cret' };
const respond = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });
const edit = (s, html, now) => applyMutation(s, { type: 'editNote', id: 'default-n1', html, text: html }, now).state;

// Echo server: returns whatever was pushed as the full remote state.
const echo = async (_url, init) => {
  const body = JSON.parse(init.body);
  return respond(JSON.stringify({ ok: true, folders: body.folders, notes: body.notes }));
};

function harness({ state = defaultState(), config = CONFIG, fetchFn = echo } = {}) {
  const h = { state, status: {}, calls: [] };
  h.syncer = createSyncer({
    readState: async () => h.state,
    updateState: async fn => (h.state = fn(h.state)),
    getConfig: async () => config,
    setStatus: async patch => { h.status = { ...h.status, ...patch }; },
    fetchFn: async (url, init) => { h.calls.push({ url, init }); return fetchFn(url, init); },
    now: () => 4242,
  });
  return h;
}

test('pushes dirty records and clears them', async () => {
  const h = harness({ state: edit(defaultState(), 'hello', 5) });
  await h.syncer.syncOnce();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, CONFIG.url);
  assert.equal(h.calls[0].init.method, 'POST');
  const body = JSON.parse(h.calls[0].init.body);
  assert.equal(body.secret, 's3cret');
  assert.equal(body.action, 'sync');
  assert.deepEqual(body.notes.map(n => n.html), ['hello']);
  assert.deepEqual(h.state.dirty, {});
  assert.deepEqual(h.status, { status: 'idle', lastSyncAt: 4242, error: null, tooLong: [] });
});

test('keeps edits made during an in-flight sync dirty', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const h = harness({
    state: edit(defaultState(), 'old', 5),
    fetchFn: async (url, init) => { await gate; return echo(url, init); },
  });
  const run = h.syncer.syncOnce();
  await new Promise(r => setImmediate(r));
  h.state = edit(h.state, 'new', 6);
  release();
  await run;
  assert.equal(h.state.notes['default-n1'].html, 'new');
  assert.ok(h.state.dirty['default-n1']);
});

test('failed fetch keeps dirty records', async () => {
  const h = harness({ state: edit(defaultState(), 'x', 5), fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  await h.syncer.syncOnce();
  assert.equal(h.status.status, 'error');
  assert.equal(h.status.error, 'Không kết nối được tới Google Sheet');
  assert.ok(h.state.dirty['default-n1']);
});

test('http error is reported with its code', async () => {
  const h = harness({ fetchFn: async () => respond('oops', 500) });
  await h.syncer.syncOnce();
  assert.equal(h.status.error, 'Google Sheet trả lỗi HTTP 500');
});

test('non-JSON response reports access error', async () => {
  const h = harness({ state: edit(defaultState(), 'x', 5), fetchFn: async () => respond('<!DOCTYPE html><html>Sign in</html>') });
  await h.syncer.syncOnce();
  assert.equal(h.status.error, 'Script chưa được deploy với quyền "Anyone" hoặc URL sai');
  assert.ok(h.state.dirty['default-n1']);
});

test('wrong secret', async () => {
  const h = harness({ fetchFn: async () => respond('{"ok":false,"error":"unauthorized"}') });
  await h.syncer.syncOnce();
  assert.equal(h.status.error, 'Sai mã bí mật');
});

test('other script error is passed through', async () => {
  const h = harness({ fetchFn: async () => respond('{"ok":false,"error":"boom"}') });
  await h.syncer.syncOnce();
  assert.equal(h.status.error, 'Lỗi từ script: boom');
});

test('no config sets status off and does not fetch', async () => {
  const h = harness({ config: null });
  await h.syncer.syncOnce();
  assert.equal(h.calls.length, 0);
  assert.equal(h.status.status, 'off');
  const h2 = harness({ config: { url: CONFIG.url, secret: '' } });
  await h2.syncer.syncOnce();
  assert.equal(h2.calls.length, 0);
});

test('concurrent calls coalesce', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let first = true;
  const h = harness({
    fetchFn: async (url, init) => {
      if (first) { first = false; await gate; }
      return echo(url, init);
    },
  });
  const runs = [h.syncer.syncOnce(), h.syncer.syncOnce(), h.syncer.syncOnce()];
  await new Promise(r => setImmediate(r));
  release();
  await Promise.all(runs);
  assert.equal(h.calls.length, 2);
});

test('testConnection returns live counts without touching state', async () => {
  const remote = {
    ok: true,
    folders: [{ id: 'a', deleted: false }, { id: 'b', deleted: true }],
    notes: [{ id: 'n', deleted: false }, { id: 'm', deleted: false }],
  };
  const h = harness({ fetchFn: async () => respond(JSON.stringify(remote)) });
  const before = h.state;
  assert.deepEqual(await h.syncer.testConnection(CONFIG), { ok: true, folders: 1, notes: 2 });
  const body = JSON.parse(h.calls[0].init.body);
  assert.deepEqual([body.folders, body.notes], [[], []]);
  assert.equal(h.state, before);

  const bad = harness({ fetchFn: async () => respond('{"ok":false,"error":"unauthorized"}') });
  assert.deepEqual(await bad.syncer.testConnection(CONFIG), { ok: false, error: 'Sai mã bí mật' });
});
