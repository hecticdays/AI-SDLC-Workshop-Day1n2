import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse/sync';
import { createStore } from '../lib/db';
import { createPortability, exportFilename, importSchema, toCsv } from '../lib/portability';

function fixture() {
  const database = new Database(':memory:');
  const store = createStore(database);
  const owner = Number(database.prepare('INSERT INTO users(username) VALUES (?)').run('owner').lastInsertRowid);
  const other = Number(database.prepare('INSERT INTO users(username) VALUES (?)').run('other').lastInsertRowid);
  return { database, store, owner, other, portability: createPortability(database) };
}

const backup = () => ({ version: 1, exported_at: '2026-10-30T12:00:00+08:00', todos: [{
  title: 'Archived checklist', completed: true, due_date: '2020-01-01T10:00:00+08:00', priority: 'high',
  is_recurring: true, recurrence_pattern: 'monthly', reminder_minutes: 30, created_at: '2020-01-01 00:00:00',
  subtasks: [{ title: 'First', completed: true, position: 99 }, { title: 'Second', completed: false, position: -3 }],
  tags: [{ name: ' Work ', color: '#ffffff' }, { name: 'work', color: '#000000' }, { name: 'New', color: '#123456' }],
}] });

test('import restores historical metadata with new IDs, normalized positions, reset notifications and reused tags', () => {
  const { database, store, owner, other, portability } = fixture();
  try {
    const tag = store.tags.create(owner, { name: 'Work', color: '#ff0000' });
    store.todos.create(other, { title: 'Private' });
    const result = portability.importAll(owner, backup());
    assert.deepEqual(result, { imported: 1, tagsCreated: 1, tagsReused: 1 });
    const first = store.todos.findAllByUser(owner)[0];
    assert.equal(first.completed, true);
    assert.equal(first.due_date, '2020-01-01T02:00:00.000Z');
    assert.equal(first.recurrence_pattern, 'monthly');
    assert.equal(first.reminder_minutes, 30);
    assert.equal(first.last_notification_sent, null);
    assert.equal(first.created_at, '2020-01-01 00:00:00');
    assert.deepEqual(first.subtasks?.map(({ title, position, completed }) => ({ title, position, completed })), [
      { title: 'First', position: 0, completed: true }, { title: 'Second', position: 1, completed: false },
    ]);
    assert.equal(first.tags?.find((value) => value.id === tag.id)?.color, '#ff0000');
    portability.importAll(owner, backup());
    const rows = store.todos.findAllByUser(owner);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(store.tags.findAllByUser(owner).length, 2);
    assert.equal(store.todos.findAllByUser(other).length, 1);
  } finally { database.close(); }
});

test('export excludes ownership, IDs, notification state and other users and round-trips valid JSON', () => {
  const { database, store, owner, other, portability } = fixture();
  try {
    portability.importAll(owner, backup());
    store.todos.create(other, { title: 'Private' });
    const exported = portability.exportAll(owner);
    assert.equal(exported.version, 1);
    assert.equal(exported.todos.length, 1);
    assert.equal(importSchema.safeParse(exported).success, true);
    assert.equal('id' in exported.todos[0], false);
    assert.equal('user_id' in exported.todos[0], false);
    assert.equal('last_notification_sent' in exported.todos[0], false);
    assert.equal('id' in exported.todos[0].subtasks[0], false);
    assert.equal('user_id' in exported.todos[0].tags[0], false);
    assert.deepEqual(portability.importAll(other, exported), { imported: 1, tagsCreated: 2, tagsReused: 0 });
  } finally { database.close(); }
});

test('a late checklist failure rolls back parent, tags and associations without changing existing data', () => {
  const { database, store, owner, portability } = fixture();
  try {
    store.todos.create(owner, { title: 'Keep me' });
    database.exec("CREATE TRIGGER reject_second BEFORE INSERT ON subtasks WHEN NEW.title = 'Second' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    assert.throws(() => portability.importAll(owner, backup()));
    assert.equal(store.todos.findAllByUser(owner).length, 1);
    assert.equal(store.tags.findAllByUser(owner).length, 0);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM subtasks').get() as { count: number }).count, 0);
    assert.equal((database.prepare('SELECT COUNT(*) AS count FROM todo_tags').get() as { count: number }).count, 0);
  } finally { database.close(); }
});

test('schema rejects invalid domains, forged ownership and inconsistent schedules before mutation', () => {
  const invalid = [
    { title: '   ' }, { title: 9 }, { priority: 'urgent' }, { due_date: 'not-a-date' },
    { due_date: null }, { reminder_minutes: 5 }, { recurrence_pattern: null },
    { is_recurring: false }, { user_id: 999 }, { tags: [{ name: ' ', color: '#000000' }] },
    { tags: [{ name: 'Valid', color: 'red' }] }, { subtasks: [{ title: '', position: 0, completed: false }] },
    { created_at: 'not-a-date' },
  ];
  for (const change of invalid) {
    const value = backup();
    assert.equal(importSchema.safeParse({ ...value, todos: [{ ...value.todos[0], ...change }] }).success, false, JSON.stringify(change));
  }
  assert.equal(importSchema.safeParse({ ...backup(), version: 2 }).success, false);
  const { database, owner, portability } = fixture();
  try { assert.deepEqual(portability.importAll(owner, { ...backup(), todos: [] }), { imported: 0, tagsCreated: 0, tagsReused: 0 }); }
  finally { database.close(); }
});

test('CSV uses fixed columns, RFC quoting and spreadsheet-safe formulas without altering JSON', () => {
  const { database, store, owner, portability } = fixture();
  try {
    const titles = ['Buy milk, eggs, "bread"\nand tea', '=SUM(A1:A2)', '+1', '-1', '@run', '\t=1', '\r=1'];
    for (const title of titles) store.todos.create(owner, { title });
    const csv = toCsv(store.todos.findAllByUser(owner));
    const rows = parse(csv, { columns: true }) as Record<string, string>[];
    assert.deepEqual(Object.keys(rows[0]), ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder']);
    assert.ok(rows.some((row) => row.Title === titles[0]));
    assert.ok(rows.filter((row) => row.Title !== titles[0]).every((row) => row.Title.startsWith("'")));
    assert.ok(portability.exportAll(owner).todos.some((todo) => todo.title === '=SUM(A1:A2)'));
  } finally { database.close(); }
});

test('download filenames follow Singapore calendar date at the UTC day boundary', () => {
  assert.equal(exportFilename('json', new Date('2026-10-30T16:01:00Z')), 'todos-2026-10-31.json');
  assert.equal(exportFilename('csv', new Date('2026-10-30T15:59:00Z')), 'todos-2026-10-30.csv');
});

test('import canonicalizes mixed due-date offsets so text sorting remains chronological', () => {
  const { database, store, owner, portability } = fixture();
  try {
    const item = backup().todos[0];
    portability.importAll(owner, { ...backup(), todos: [
      { ...item, title: 'Later', due_date: '2030-01-01T03:00:00Z' },
      { ...item, title: 'Earlier', due_date: '2030-01-01T10:00:00+08:00' },
    ] });
    assert.deepEqual(store.todos.findAllByUser(owner).map((todo) => todo.title), ['Earlier', 'Later']);
  } finally { database.close(); }
});