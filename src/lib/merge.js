// Last-write-wins sync between local state and the Sheet.
// apps-script/Code.gs mirrors the same rule on the server side.

import { MAX_HTML } from './model.js';
import { sanitizeHtml } from './sanitize.js';

export function collectChanges(state) {
  const folders = [];
  const notes = [];
  const sent = {};
  const tooLong = [];
  for (const id of Object.keys(state.dirty)) {
    if (state.folders[id]) {
      folders.push(state.folders[id]);
      sent[id] = state.folders[id].updatedAt;
    } else if (state.notes[id]) {
      const note = state.notes[id];
      if (note.html.length > MAX_HTML) {
        tooLong.push(id);
        continue;
      }
      notes.push(note);
      sent[id] = note.updatedAt;
    }
  }
  return { folders, notes, sent, tooLong };
}

// `sent` maps id -> updatedAt of the version pushed in this round. A local
// record edited after it was sent is newer than `sent[id]` and stays dirty.
export function mergeRemote(state, remote, sent) {
  const s = {
    folders: { ...state.folders },
    notes: { ...state.notes },
    dirty: { ...state.dirty },
  };
  const take = (map, record) => {
    const local = map[record.id];
    if (!local || record.updatedAt > local.updatedAt) {
      map[record.id] = record;
      delete s.dirty[record.id];
    }
  };
  for (const f of remote.folders || []) take(s.folders, f);
  for (const n of remote.notes || []) take(s.notes, { ...n, html: sanitizeHtml(n.html) });

  for (const [id, updatedAt] of Object.entries(sent)) {
    const local = s.folders[id] || s.notes[id];
    if (local && local.updatedAt === updatedAt) delete s.dirty[id];
  }
  return s;
}

// True when a sync round would actually send something. A too-long note
// stays dirty but cannot be sent, so it must not keep the retry alarm busy.
export function hasPushable(state) {
  const { folders, notes } = collectChanges(state);
  return folders.length + notes.length > 0;
}
