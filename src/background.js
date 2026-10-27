// Service worker: the only writer of note data. The popup sends mutations
// here; they are applied one at a time so concurrent writes never clobber.

import { applyMutation, defaultState } from './lib/model.js';
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

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return config || null;
}

async function getStatus() {
  const { syncStatus } = await chrome.storage.local.get('syncStatus');
  return { status: 'off', lastSyncAt: null, error: null, tooLong: [], ...syncStatus };
}

async function setStatus(patch) {
  await chrome.storage.local.set({ syncStatus: { ...(await getStatus()), ...patch } });
}

const syncer = createSyncer({
  readState,
  updateState,
  getConfig,
  setStatus,
  fetchFn: (url, init) => fetch(url, init),
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
      const [state, config, status] = await Promise.all([readState(), getConfig(), getStatus()]);
      return { state, config, status };
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
    case 'saveConfig':
      await chrome.storage.local.set({ config: { url: msg.config.url.trim(), secret: msg.config.secret } });
      syncer.syncOnce();
      return { ok: true };
    case 'testConnection':
      return syncer.testConnection({ url: msg.config.url.trim(), secret: msg.config.secret });
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
  const state = await readState();
  if (Object.keys(state.dirty).length) await syncer.syncOnce();
});
