import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createStore } from '../lib/db';
import { REMINDER_LABELS, reminderLabel } from '../lib/reminders';

function fixture() {
  const database = new Database(':memory:');
  const store = createStore(database);
  database.prepare("INSERT INTO users(id, username) VALUES (1, 'owner'), (2, 'other')").run();
  const insert = database.prepare(`INSERT INTO todos(user_id, title, due_date, reminder_minutes, completed, last_notification_sent)
    VALUES (?, ?, ?, ?, ?, ?)`);
  return { database, store, insert };
}

test('reminder labels cover the seven supported timings', () => {
  assert.deepEqual(Object.keys(REMINDER_LABELS).map(Number), [15, 30, 60, 120, 1440, 2880, 10080]);
  assert.equal(reminderLabel(60), '1h');
  assert.equal(reminderLabel(10080), '1w');
});

test('due reminders are claimed once inside the Singapore reminder window and stay user scoped', () => {
  const { database, store, insert } = fixture();
  try {
    const now = new Date('2026-01-01T16:00:00.000Z');
    insert.run(1, 'Midnight SGT', '2026-01-01T16:30:00.000Z', 30, 0, null);
    insert.run(1, 'Too early', '2026-01-01T17:00:00.000Z', 30, 0, null);
    insert.run(1, 'Past due', '2026-01-01T15:59:59.000Z', 60, 0, null);
    insert.run(1, 'Completed', '2026-01-01T16:15:00.000Z', 30, 1, null);
    insert.run(1, 'Already sent', '2026-01-01T16:15:00.000Z', 30, 0, '2026-01-01T15:50:00.000Z');
    insert.run(2, 'Other user', '2026-01-01T16:15:00.000Z', 30, 0, null);

    const claimed = store.todos.claimDueReminders(1, now);
    assert.deepEqual(claimed.map((todo) => todo.title), ['Midnight SGT']);
    assert.equal(claimed[0].last_notification_sent, now.toISOString());
    assert.deepEqual(store.todos.claimDueReminders(1, now), []);
    assert.deepEqual(store.todos.claimDueReminders(2, now).map((todo) => todo.title), ['Other user']);
  } finally { database.close(); }
});

test('changing due date or reminder timing resets notification eligibility', () => {
  const { database, store } = fixture();
  try {
    const due = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const todo = store.todos.create(1, { title: 'Reminder', due_date: due, reminder_minutes: 120 });
    assert.equal(store.todos.claimDueReminders(1, new Date(Date.now() + 60_000)).length, 1);

    assert.notEqual(store.todos.update(todo.id, 1, { title: 'Renamed' }).last_notification_sent, null);
    assert.equal(store.todos.update(todo.id, 1, { reminder_minutes: 60 }).last_notification_sent, null);
    database.prepare('UPDATE todos SET last_notification_sent = ? WHERE id = ?').run(new Date().toISOString(), todo.id);
    const moved = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    assert.equal(store.todos.update(todo.id, 1, { due_date: moved }).last_notification_sent, null);
  } finally { database.close(); }
});
