import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_NOTES, DEFAULT_FOLDER_ID, defaultState, applyMutation, liveFolders, liveNotes,
} from '../src/lib/model.js';

function withFolder(state, id = 'f2', noteIds = ['n1', 'n2']) {
  return applyMutation(state, { type: 'addFolder', id, name: 'Folder 2', noteIds }, 1000).state;
}

test('default folder is not dirty', () => {
  const s = defaultState();
  const folders = liveFolders(s);
  assert.equal(folders.length, 1);
  assert.equal(folders[0].id, DEFAULT_FOLDER_ID);
  assert.equal(folders[0].name, 'Folder 1');
  assert.equal(liveNotes(s, DEFAULT_FOLDER_ID).length, 2);
  assert.deepEqual(s.dirty, {});
  assert.ok([...Object.values(s.folders), ...Object.values(s.notes)].every(r => r.updatedAt === 0));
});

test('addFolder creates two empty notes and marks dirty', () => {
  const s = withFolder(defaultState());
  const notes = liveNotes(s, 'f2');
  assert.equal(notes.length, 2);
  assert.ok(notes.every(n => n.html === '' && n.text === ''));
  assert.deepEqual(Object.keys(s.dirty).sort(), ['f2', 'n1', 'n2']);
  assert.equal(s.folders.f2.updatedAt, 1000);
  assert.equal(s.folders.f2.order, 1);
  assert.deepEqual(liveFolders(s).map(f => f.id), [DEFAULT_FOLDER_ID, 'f2']);
});

test('addNote refuses a fourth note', () => {
  let s = withFolder(defaultState());
  s = applyMutation(s, { type: 'addNote', id: 'n3', folderId: 'f2' }, 2000).state;
  assert.equal(liveNotes(s, 'f2').length, MAX_NOTES);
  assert.deepEqual(liveNotes(s, 'f2').map(n => n.id), ['n1', 'n2', 'n3']);
  assert.deepEqual(applyMutation(s, { type: 'addNote', id: 'n4', folderId: 'f2' }, 3000), { error: 'max_notes' });
});

test('deleteFolder tombstones notes and refuses last folder', () => {
  const only = defaultState();
  assert.deepEqual(applyMutation(only, { type: 'deleteFolder', id: DEFAULT_FOLDER_ID }, 1), { error: 'last_folder' });

  const s = applyMutation(withFolder(only), { type: 'deleteFolder', id: 'f2' }, 5000).state;
  assert.equal(s.folders.f2.deleted, true);
  assert.equal(s.notes.n1.deleted, true);
  assert.equal(s.notes.n2.deleted, true);
  assert.equal(s.notes.n1.updatedAt, 5000);
  assert.ok(s.dirty.f2 && s.dirty.n1 && s.dirty.n2);
  assert.deepEqual(liveFolders(s).map(f => f.id), [DEFAULT_FOLDER_ID]);
});

test('renameFolder trims and rejects empty', () => {
  const s = applyMutation(defaultState(), { type: 'renameFolder', id: DEFAULT_FOLDER_ID, name: '  A  ' }, 10).state;
  assert.equal(s.folders[DEFAULT_FOLDER_ID].name, 'A');
  assert.ok(s.dirty[DEFAULT_FOLDER_ID]);
  assert.deepEqual(applyMutation(s, { type: 'renameFolder', id: DEFAULT_FOLDER_ID, name: '   ' }, 11), { error: 'empty_name' });
  const long = applyMutation(s, { type: 'renameFolder', id: DEFAULT_FOLDER_ID, name: 'x'.repeat(40) }, 12).state;
  assert.equal(long.folders[DEFAULT_FOLDER_ID].name.length, 30);
});

test('editNote and deleteNote update the note', () => {
  let s = applyMutation(defaultState(), { type: 'editNote', id: 'default-n1', html: '<b>a</b>', text: 'a' }, 7).state;
  assert.equal(s.notes['default-n1'].html, '<b>a</b>');
  assert.equal(s.notes['default-n1'].text, 'a');
  assert.equal(s.notes['default-n1'].updatedAt, 7);
  s = applyMutation(s, { type: 'deleteNote', id: 'default-n2' }, 8).state;
  assert.deepEqual(liveNotes(s, DEFAULT_FOLDER_ID).map(n => n.id), ['default-n1']);
});

test('unknown record or mutation is an error', () => {
  assert.deepEqual(applyMutation(defaultState(), { type: 'editNote', id: 'nope', html: '', text: '' }, 1), { error: 'not_found' });
  assert.deepEqual(applyMutation(defaultState(), { type: 'bogus' }, 1), { error: 'bad_mutation' });
});

test('applyMutation does not mutate input', () => {
  const s = defaultState();
  const before = structuredClone(s);
  applyMutation(s, { type: 'editNote', id: 'default-n1', html: 'x', text: 'x' }, 1);
  applyMutation(s, { type: 'addFolder', id: 'f', name: 'F', noteIds: ['a', 'b'] }, 1);
  assert.deepEqual(s, before);
});
