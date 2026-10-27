// One sync round against the Apps Script Web App, with all I/O injected so
// it can be tested without Chrome.

import { collectChanges, mergeRemote } from './merge.js';

class SyncError extends Error {}

async function request(fetchFn, config, folders, notes) {
  let res;
  try {
    res = await fetchFn(config.url, {
      method: 'POST',
      // text/plain keeps this a "simple" request (no CORS preflight).
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: config.secret, action: 'sync', folders, notes }),
    });
  } catch {
    throw new SyncError('Không kết nối được tới Google Sheet');
  }
  if (res.status >= 400) throw new SyncError(`Google Sheet trả lỗi HTTP ${res.status}`);
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    // Google serves an HTML sign-in page when the Web App is not public.
    throw new SyncError('Script chưa được deploy với quyền "Anyone" hoặc URL sai');
  }
  if (!body || body.ok !== true) {
    if (body?.error === 'unauthorized') throw new SyncError('Sai mã bí mật');
    throw new SyncError(`Lỗi từ script: ${body?.error ?? 'không rõ'}`);
  }
  return body;
}

const isConfigured = config => Boolean(config?.url && config?.secret);

export function createSyncer({ readState, updateState, getConfig, setStatus, fetchFn, now }) {
  let running = null;
  let again = false;

  async function round() {
    const config = await getConfig();
    if (!isConfigured(config)) {
      await setStatus({ status: 'off' });
      return;
    }
    await setStatus({ status: 'syncing' });
    const { folders, notes, sent, tooLong } = collectChanges(await readState());
    try {
      const remote = await request(fetchFn, config, folders, notes);
      // Merge into the current state, which may have changed during the fetch.
      await updateState(s => mergeRemote(s, remote, sent));
      await setStatus({ status: 'idle', lastSyncAt: now(), error: null, tooLong });
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      await setStatus({ status: 'error', error: err.message, tooLong });
    }
  }

  // Calls made while a round is in flight share it and trigger exactly one
  // more round afterwards, so their changes are not left behind.
  function syncOnce() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await round();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function testConnection(config) {
    if (!isConfigured(config)) return { ok: false, error: 'Cần nhập URL và mã bí mật' };
    try {
      const remote = await request(fetchFn, config, [], []);
      const live = list => (list || []).filter(r => r.deleted !== true).length;
      return { ok: true, folders: live(remote.folders), notes: live(remote.notes) };
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      return { ok: false, error: err.message };
    }
  }

  return { syncOnce, testConnection };
}
