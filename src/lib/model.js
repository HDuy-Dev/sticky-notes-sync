// Data model shared by the popup and the background worker.
// Folder: { id, name, order, updatedAt, deleted }
// Note:   { id, folderId, order, html, text, updatedAt, deleted }
// State:  { folders: { [id]: Folder }, notes: { [id]: Note }, dirty: { [id]: true } }

export const MAX_NOTES = 3;
export const MAX_HTML = 45000;
export const MAX_FOLDER_NAME = 30;
export const DEFAULT_FOLDER_ID = 'default';

export function newId() {
  return crypto.randomUUID();
}

function makeNote(id, folderId, order, updatedAt) {
  return { id, folderId, order, html: '', text: '', updatedAt, deleted: false };
}

// The default folder has fixed ids and updatedAt 0 so a fresh install on a
// second browser never pushes a duplicate "Folder 1" to the Sheet.
export function defaultState() {
  return {
    folders: {
      [DEFAULT_FOLDER_ID]: { id: DEFAULT_FOLDER_ID, name: 'Folder 1', order: 0, updatedAt: 0, deleted: false },
    },
    notes: {
      'default-n1': makeNote('default-n1', DEFAULT_FOLDER_ID, 0, 0),
      'default-n2': makeNote('default-n2', DEFAULT_FOLDER_ID, 1, 0),
    },
    dirty: {},
  };
}

export function liveFolders(state) {
  return Object.values(state.folders).filter(f => !f.deleted).sort((a, b) => a.order - b.order);
}

export function liveNotes(state, folderId) {
  return Object.values(state.notes)
    .filter(n => n.folderId === folderId && !n.deleted)
    .sort((a, b) => a.order - b.order);
}

function nextOrder(records) {
  return records.reduce((max, r) => Math.max(max, r.order), -1) + 1;
}

// Pure: returns { state } with a new object, or { error }.
export function applyMutation(state, mutation, now) {
  const s = {
    folders: { ...state.folders },
    notes: { ...state.notes },
    dirty: { ...state.dirty },
  };
  const touchFolder = (id, patch) => {
    s.folders[id] = { ...s.folders[id], ...patch, updatedAt: now };
    s.dirty[id] = true;
  };
  const touchNote = (id, patch) => {
    s.notes[id] = { ...s.notes[id], ...patch, updatedAt: now };
    s.dirty[id] = true;
    // A never-synced folder (the default one) must reach the Sheet with its
    // first note; updatedAt stays 0 so any real edit elsewhere still wins.
    const folder = s.folders[s.notes[id].folderId];
    if (folder && folder.updatedAt === 0) s.dirty[folder.id] = true;
  };
  const liveFolder = id => s.folders[id] && !s.folders[id].deleted;
  const liveNote = id => s.notes[id] && !s.notes[id].deleted;

  switch (mutation.type) {
    case 'addFolder': {
      const name = (mutation.name || '').trim().slice(0, MAX_FOLDER_NAME) || 'Folder';
      s.folders[mutation.id] = { id: mutation.id, name, order: nextOrder(liveFolders(s)), updatedAt: now, deleted: false };
      s.dirty[mutation.id] = true;
      mutation.noteIds.forEach((noteId, i) => {
        s.notes[noteId] = makeNote(noteId, mutation.id, i, now);
        s.dirty[noteId] = true;
      });
      return { state: s };
    }
    case 'renameFolder': {
      if (!liveFolder(mutation.id)) return { error: 'not_found' };
      const name = (mutation.name || '').trim().slice(0, MAX_FOLDER_NAME);
      if (!name) return { error: 'empty_name' };
      touchFolder(mutation.id, { name });
      return { state: s };
    }
    case 'deleteFolder': {
      if (!liveFolder(mutation.id)) return { error: 'not_found' };
      if (liveFolders(s).length <= 1) return { error: 'last_folder' };
      for (const n of liveNotes(s, mutation.id)) touchNote(n.id, { deleted: true });
      touchFolder(mutation.id, { deleted: true });
      return { state: s };
    }
    case 'addNote': {
      if (!liveFolder(mutation.folderId)) return { error: 'not_found' };
      const notes = liveNotes(s, mutation.folderId);
      if (notes.length >= MAX_NOTES) return { error: 'max_notes' };
      s.notes[mutation.id] = makeNote(mutation.id, mutation.folderId, nextOrder(notes), now);
      s.dirty[mutation.id] = true;
      return { state: s };
    }
    case 'editNote': {
      if (!liveNote(mutation.id)) return { error: 'not_found' };
      touchNote(mutation.id, { html: mutation.html, text: mutation.text });
      return { state: s };
    }
    case 'deleteNote': {
      if (!liveNote(mutation.id)) return { error: 'not_found' };
      touchNote(mutation.id, { deleted: true });
      return { state: s };
    }
    default:
      return { error: 'bad_mutation' };
  }
}
