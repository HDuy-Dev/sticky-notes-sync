import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyMutation, liveFolders, DEFAULT_FOLDER_ID } from '../src/lib/model.js';
import { collectChanges, mergeRemote, hasPushable } from '../src/lib/merge.js';

const edit = (s, id, html, now) => applyMutation(s, { type: 'editNote', id, html, text: html }, now).state;
const note = (id, html, updatedAt, extra = {}) => ({
  id, folderId: DEFAULT_FOLDER_ID, order: 0, html, text: html, updatedAt, deleted: false, ...extra,
});

test('collectChanges returns only dirty records', () => {
  const s = edit(defaultState(), 'default-n1', 'a', 5);
  const c = collectChanges(s);
  // The pristine default folder travels with its first edited note.
  assert.deepEqual(c.folders.map(f => f.id), [DEFAULT_FOLDER_ID]);
  assert.deepEqual(c.notes.map(n => n.id), ['default-n1']);
  assert.deepEqual(c.sent, { 'default-n1': 5, [DEFAULT_FOLDER_ID]: 0 });
  assert.deepEqual(c.tooLong, []);
});

test('collectChanges skips too-long notes', () => {
  const s = edit(defaultState(), 'default-n1', 'x'.repeat(45001), 5);
  const c = collectChanges(s);
  assert.deepEqual(c.notes, []);
  assert.deepEqual(c.sent, { [DEFAULT_FOLDER_ID]: 0 });
  assert.deepEqual(c.tooLong, ['default-n1']);
  assert.ok(s.dirty['default-n1']);
});

test('remote newer wins, local newer kept', () => {
  const s = edit(defaultState(), 'default-n1', 'local', 5);
  const merged = mergeRemote(s, { folders: [], notes: [note('default-n1', 'remote', 7)] }, {});
  assert.equal(merged.notes['default-n1'].html, 'remote');
  assert.ok(!merged.dirty['default-n1']);

  const s2 = edit(defaultState(), 'default-n1', 'local', 9);
  const kept = mergeRemote(s2, { folders: [], notes: [note('default-n1', 'remote', 7)] }, {});
  assert.equal(kept.notes['default-n1'].html, 'local');
  assert.ok(kept.dirty['default-n1']);
});

test('clears dirty only for unchanged sent records', () => {
  const s = edit(defaultState(), 'default-n1', 'a', 5);
  const remote = { folders: [], notes: [note('default-n1', 'a', 5)] };
  assert.ok(!mergeRemote(s, remote, { 'default-n1': 5 }).dirty['default-n1']);

  const newer = edit(s, 'default-n1', 'ab', 6);
  const merged = mergeRemote(newer, remote, { 'default-n1': 5 });
  assert.ok(merged.dirty['default-n1']);
  assert.equal(merged.notes['default-n1'].html, 'ab');
});

test('remote default folder wins over pristine local default', () => {
  const remote = {
    folders: [{ id: DEFAULT_FOLDER_ID, name: 'Work', order: 0, updatedAt: 100, deleted: false }],
    notes: [],
  };
  const merged = mergeRemote(defaultState(), remote, {});
  assert.equal(merged.folders[DEFAULT_FOLDER_ID].name, 'Work');
  assert.deepEqual(merged.dirty, {});
});

test('remote tombstone hides folder', () => {
  let s = applyMutation(defaultState(), { type: 'addFolder', id: 'f2', name: 'F2', noteIds: ['a', 'b'] }, 10).state;
  s = mergeRemote(s, { folders: [], notes: [] }, collectChanges(s).sent);
  const remote = { folders: [{ id: 'f2', name: 'F2', order: 1, updatedAt: 20, deleted: true }], notes: [] };
  assert.deepEqual(liveFolders(mergeRemote(s, remote, {})).map(f => f.id), [DEFAULT_FOLDER_ID]);
});

test('remote-only records are added', () => {
  const merged = mergeRemote(defaultState(), { folders: [], notes: [note('new', 'hi', 3)] }, {});
  assert.equal(merged.notes.new.html, 'hi');
});

test('remote html is sanitized', () => {
  const merged = mergeRemote(defaultState(), { folders: [], notes: [note('default-n1', '<script>x</script>y', 9)] }, {});
  assert.equal(merged.notes['default-n1'].html, 'y');
});

test('mergeRemote does not mutate input', () => {
  const s = edit(defaultState(), 'default-n1', 'a', 5);
  const before = structuredClone(s);
  mergeRemote(s, { folders: [], notes: [note('default-n1', 'r', 9)] }, { 'default-n1': 5 });
  assert.deepEqual(s, before);
});

test('hasPushable ignores records that cannot be sent', () => {
  assert.equal(hasPushable(defaultState()), false);
  assert.equal(hasPushable(edit(defaultState(), 'default-n1', 'a', 5)), true);
  const long = edit(defaultState(), 'default-n1', 'x'.repeat(45001), 5);
  // Only the too-long note (and its folder, already synced) remain dirty.
  const synced = mergeRemote(long, { folders: [], notes: [] }, collectChanges(long).sent);
  assert.deepEqual(Object.keys(synced.dirty), ['default-n1']);
  assert.equal(hasPushable(synced), false);
});
