// Service worker: the only writer of note data. The popup sends mutations
// here; they are applied one at a time so concurrent writes never clobber.

import { GOOGLE_CLIENT_ID } from './config.js';
import { applyMutation, defaultState } from './lib/model.js';
import { hasPushable } from './lib/merge.js';
import { createAuth } from './lib/google-auth.js';
import { createSheetsStore } from './lib/sheets-store.js';
import { createSyncer } from './lib/sync.js';

const PUSH_DELAY_MS = 2000;
const ALARM = 'sync';

let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function loadState() {
  const { state } = await chrome.storage.local.get('state');
  return state || defaultState();
}

function readState() {
  return enqueue(loadState);
}

function updateState(fn) {
  return enqueue(async () => {
    const next = fn(await loadState());
    await chrome.storage.local.set({ state: next });
    return next;
  });
}

async function getStatus() {
  const { syncStatus } = await chrome.storage.local.get('syncStatus');
  return { status: 'off', lastSyncAt: null, error: null, tooLong: [], ...syncStatus };
}

async function setStatus(patch) {
  await chrome.storage.local.set({ syncStatus: { ...(await getStatus()), ...patch } });
}

const auth = createAuth({
  identity: chrome.identity,
  session: chrome.storage.session,
  local: chrome.storage.local,
  fetchFn: (url, init) => fetch(url, init),
  clientId: GOOGLE_CLIENT_ID,
  now: () => Date.now(),
});

const store = createSheetsStore({
  fetchFn: (url, init) => fetch(url, init),
  getToken: () => auth.getToken({ interactive: false }),
  onUnauthorized: () => auth.invalidate(),
});

const syncer = createSyncer({
  readState,
  updateState,
  setStatus,
  auth,
  store,
  local: chrome.storage.local,
  now: () => Date.now(),
});

let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => syncer.syncOnce(), PUSH_DELAY_MS);
}

async function handle(msg) {
  switch (msg?.type) {
    case 'getState': {
      const [state, status, account, { sheet }] = await Promise.all([
        readState(), getStatus(), auth.getAccount(), chrome.storage.local.get('sheet'),
      ]);
      const sheetUrl = account && sheet?.email === account.email ? store.url(sheet.spreadsheetId) : null;
      return { state, status, account, sheetUrl, pendingSignIn: syncer.pendingSignIn() };
    }
    case 'mutate': {
      let error = null;
      await updateState(s => {
        const result = applyMutation(s, msg.mutation, Date.now());
        if (result.error) {
          error = result.error;
          return s;
        }
        return result.state;
      });
      if (error) return { ok: false, error };
      schedulePush();
      return { ok: true };
    }
    case 'syncNow':
      await syncer.syncOnce();
      return { ok: true };
    case 'signIn':
      return syncer.signIn();
    case 'confirmSignIn':
      return syncer.confirmSignIn();
    case 'cancelSignIn':
      return syncer.cancelSignIn();
    case 'signOut':
      return syncer.signOut(msg.keepNotes !== false);
    default:
      return { ok: false, error: 'unknown_message' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg).then(sendResponse, err => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

function ensureAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM) return;
  if (hasPushable(await readState())) await syncer.syncOnce();
});
