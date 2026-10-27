import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, applyMutation, DEFAULT_FOLDER_ID } from '../src/lib/model.js';
import { FOLDER_COLUMNS, NOTE_COLUMNS, parseTab, folderRow, noteRow, planWrites } from '../src/lib/sheet-rows.js';

const note = (id, updatedAt, extra = {}) => ({
  id, folderId: 'f', order: 0, html: 'h', text: 't', updatedAt, deleted: false, ...extra,
});

test('parses typed records and row numbers', () => {
  const values = [
    NOTE_COLUMNS,
    ['a', 'f', 'Work', 0, '0912', '<b>0912</b>', 10, false, '2026-01-01'],
    ['b', 'f', 'Work', '1', 'x', 'x', '20', 'TRUE', ''],
  ];
  const { records, rowById } = parseTab(values, 'notes');
  assert.deepEqual(records, [
    { id: 'a', folderId: 'f', order: 0, text: '0912', html: '<b>0912</b>', updatedAt: 10, deleted: false },
    { id: 'b', folderId: 'f', order: 1, text: 'x', html: 'x', updatedAt: 20, deleted: true },
  ]);
  assert.deepEqual(rowById, { a: 2, b: 3 });

  const folders = parseTab([FOLDER_COLUMNS, ['f', 'Work', 0, 5, false, '']], 'folders');
  assert.deepEqual(folders.records, [{ id: 'f', name: 'Work', order: 0, updatedAt: 5, deleted: false }]);
});

test('skips empty rows and handles a missing tab', () => {
  const { records, rowById } = parseTab([NOTE_COLUMNS, [], ['', 'f'], ['a', 'f', '', 0, '', '', 1, false]], 'notes');
  assert.deepEqual(records.map(r => r.id), ['a']);
  assert.deepEqual(rowById, { a: 4 });
  assert.deepEqual(parseTab(undefined, 'notes'), { records: [], rowById: {} });
});

test('duplicate ids keep newest row', () => {
  const { records, rowById } = parseTab([
    NOTE_COLUMNS,
    ['a', 'f', '', 0, 'old', 'old', 1, false],
    ['a', 'f', '', 0, 'new', 'new', 9, false],
    ['a', 'f', '', 0, 'mid', 'mid', 5, false],
  ], 'notes');
  assert.deepEqual(records.map(r => r.text), ['new']);
  assert.deepEqual(rowById, { a: 3 });
});

test('noteRow puts folder name and ISO date', () => {
  assert.deepEqual(noteRow(note('a', 0), 'Work'), ['a', 'f', 'Work', 0, 't', 'h', 0, false, '1970-01-01T00:00:00.000Z']);
  assert.deepEqual(folderRow({ id: 'f', name: 'W', order: 2, updatedAt: 0, deleted: true }), ['f', 'W', 2, 0, true, '1970-01-01T00:00:00.000Z']);
});

test('planWrites updates known rows and appends new ones', () => {
  const state = { folders: { f: { id: 'f', name: 'Work', order: 0, updatedAt: 1, deleted: false } }, notes: {}, dirty: {} };
  const changes = {
    folders: [{ id: 'g', name: 'New', order: 1, updatedAt: 3, deleted: false }],
    notes: [note('a', 2), note('b', 2)],
  };
  const rowIndex = { folders: { g: 3 }, notes: { a: 2 } };
  const plan = planWrites(changes, rowIndex, state);
  assert.deepEqual(plan.updates.map(u => u.range), ['Folders!A3:F3', 'Notes!A2:I2']);
  assert.equal(plan.updates[1].values[0][2], 'Work');
  assert.deepEqual(plan.appends.Folders, []);
  assert.deepEqual(plan.appends.Notes.map(r => r[0]), ['b']);
});

test('planWrites only touches changed records', () => {
  let s = defaultState();
  s = applyMutation(s, { type: 'addNote', id: 'n3', folderId: DEFAULT_FOLDER_ID }, 1).state;
  const changes = { folders: [], notes: [{ ...s.notes['default-n2'], html: 'x', updatedAt: 2 }] };
  const rowIndex = { folders: { [DEFAULT_FOLDER_ID]: 2 }, notes: { 'default-n1': 2, 'default-n2': 3, n3: 4 } };
  const plan = planWrites(changes, rowIndex, s);
  assert.deepEqual(plan.updates.map(u => u.range), ['Notes!A3:I3']);
  assert.deepEqual(plan.appends, { Folders: [], Notes: [] });
});

test('folder rename rewrites its notes folder column', () => {
  const s = applyMutation(defaultState(), { type: 'renameFolder', id: DEFAULT_FOLDER_ID, name: 'Work' }, 5).state;
  const changes = { folders: [s.folders[DEFAULT_FOLDER_ID]], notes: [] };
  const rowIndex = { folders: { [DEFAULT_FOLDER_ID]: 2 }, notes: { 'default-n1': 2 } };
  const plan = planWrites(changes, rowIndex, s);
  assert.deepEqual(plan.updates.map(u => u.range), ['Folders!A2:F2', 'Notes!A2:I2']);
  assert.equal(plan.updates[1].values[0][2], 'Work');
  assert.deepEqual(plan.appends.Notes.map(r => [r[0], r[2]]), [['default-n2', 'Work']]);
});
