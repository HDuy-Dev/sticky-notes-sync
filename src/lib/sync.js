// One sync round against the user's Google Sheet, plus sign-in/out flows.
// All I/O is injected so this runs in tests without Chrome or Google.
//
// Round: read the sheet -> merge it in (last write wins) -> write only the
// rows this device changed -> clear dirty for what was written unchanged.

import { collectChanges, mergeRemote } from './merge.js';
import { defaultState, markAllDirty, DEFAULT_FOLDER_ID } from './model.js';
import { planWrites } from './sheet-rows.js';
import { AuthRequired } from './google-auth.js';
import { SheetMissing, ApiError } from './sheets-store.js';

// Anything worth asking about before it lands in another account's sheet.
export function hasLocalNotes(state) {
  const notes = Object.values(state.notes).some(n => !n.deleted && n.text.trim());
  const folders = Object.values(state.folders).some(f => !f.deleted && (f.id !== DEFAULT_FOLDER_ID || f.updatedAt > 0));
  return notes || folders;
}

function describe(err) {
  if (err instanceof AuthRequired) return { status: 'signin', error: 'Please sign in again' };
  if (err instanceof TypeError) return { status: 'error', error: "Can't reach Google" };
  if (err instanceof ApiError) return { status: 'error', error: `Google returned an error (${err.status})` };
  if (err instanceof SheetMissing) return { status: 'error', error: 'Google Sheet not found' };
  return { status: 'error', error: err?.message || 'Unknown error' };
}

export function createSyncer({ readState, updateState, setStatus, auth, store, local, now }) {
  let running = null;
  let again = false;
  let pending = null; // { email, previousEmail } awaiting the user's answer

  const getLocal = async key => (await local.get(key))[key];

  async function ensureSheet(email) {
    const sheet = await getLocal('sheet');
    if (sheet?.email === email) return sheet.spreadsheetId;
    const { spreadsheetId } = await store.findOrCreate();
    // A different spreadsheet than last time has none of our data yet.
    if (sheet?.spreadsheetId !== spreadsheetId) await updateState(markAllDirty);
    await local.set({ sheet: { spreadsheetId, email } });
    return spreadsheetId;
  }

  async function round() {
    const account = await auth.getAccount();
    if (!account) {
      await setStatus({ status: 'off', error: null });
      return;
    }
    await setStatus({ status: 'syncing' });
    let tooLong = [];
    try {
      await auth.getToken({ interactive: false });
      let id = await ensureSheet(account.email);
      let remote;
      try {
        remote = await store.readAll(id);
      } catch (err) {
        if (!(err instanceof SheetMissing)) throw err;
        // The user deleted the sheet: start a new one and push everything.
        await local.remove('sheet');
        id = await ensureSheet(account.email);
        remote = await store.readAll(id);
      }
      await updateState(s => mergeRemote(s, remote, {}));

      const state = await readState();
      const changes = collectChanges(state);
      tooLong = changes.tooLong;
      await store.write(id, planWrites(changes, remote.rowIndex, state));
      // Edits made while writing are newer than `sent` and stay dirty.
      await updateState(s => mergeRemote(s, { folders: changes.folders, notes: changes.notes }, changes.sent));
      await setStatus({ status: 'idle', lastSyncAt: now(), error: null, tooLong });
    } catch (err) {
      await setStatus({ ...describe(err), tooLong });
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

  async function commit(email) {
    const sheet = await getLocal('sheet');
    if (sheet && sheet.email !== email) await local.remove('sheet');
    await local.set({ account: { email }, lastEmail: email });
    pending = null;
    syncOnce();
    return { ok: true, email };
  }

  async function signIn() {
    let email;
    try {
      ({ email } = await auth.signIn());
    } catch (err) {
      if (err instanceof AuthRequired) return { ok: false, error: 'Sign-in was cancelled' };
      return { ok: false, error: describe(err).error };
    }
    const previousEmail = await getLocal('lastEmail');
    if (previousEmail && previousEmail !== email && hasLocalNotes(await readState())) {
      pending = { email, previousEmail };
      return { ok: false, needsConfirm: true, email, previousEmail };
    }
    return commit(email);
  }

  async function confirmSignIn() {
    if (!pending) return { ok: false, error: 'Nothing to confirm' };
    return commit(pending.email);
  }

  async function cancelSignIn() {
    pending = null;
    await auth.signOut();
    return { ok: true };
  }

  async function signOut(keepNotes) {
    await auth.signOut();
    await local.remove('sheet');
    if (!keepNotes) await updateState(() => defaultState());
    await setStatus({ status: 'off', error: null, tooLong: [] });
    return { ok: true };
  }

  // The popup may close while Google's sign-in window has focus, so it asks
  // again on reopen.
  const pendingSignIn = () => pending;

  return { syncOnce, signIn, confirmSignIn, cancelSignIn, signOut, pendingSignIn };
}
