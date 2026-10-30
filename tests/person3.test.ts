import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createStore, DataError, todoInputSchema, templateInputSchema, parseTemplateSubtasks,
  getDatabase, getStore, subtaskDB, templateDB, todoDB, tagDB } from '../lib/db';
import { calculateProgress } from '../lib/progress';
import { getSingaporeNow } from '../lib/timezone';

function fixture() {
  const database = new Database(':memory:');
  const store = createStore(database);
  database.prepare("INSERT INTO users(id, username) VALUES (1, 'owner'), (2, 'other')").run();
  return { database, ...store };
}
const missing = (action: () => unknown) => assert.throws(action, (error: unknown) => error instanceof DataError && error.status === 404);

test('progress is client-safe, rounded and immutable including zero and complete', () => {
  assert.deepEqual(calculateProgress([]), { completed: 0, total: 0, percent: 0 });
  const children = Object.freeze(Array.from({ length: 7 }, (_, index) => Object.freeze({ completed: index < 3 })));
  assert.deepEqual(calculateProgress(children), { completed: 3, total: 7, percent: 43 });
  assert.equal(calculateProgress([{ completed: false }]).percent, 0);
  assert.equal(calculateProgress([{ completed: true }]).percent, 100);
  assert.equal(calculateProgress([{ completed: true }, { completed: false }, { completed: false }]).percent, 33);
  assert.equal(calculateProgress([{ completed: true }, { completed: true }, { completed: false }]).percent, 67);
  assert.equal(calculateProgress(Array.from({ length: 10_000 }, (_, index) => ({ completed: index < 2500 }))).percent, 25);
});

test('subtask CRUD is ordered, scoped through parent, independent and cascades', () => {
  const { database, todos, subtasks } = fixture();
  try {
    const parent = todos.create(1, { title: 'Project' });
    const first = subtasks.create(parent.id, 1, { title: '  First  ' });
    const second = subtasks.create(parent.id, 1, { title: 'Second' });
    assert.equal(first.title, 'First');
    assert.equal(second.position, first.position + 1);
    for (const action of [() => subtasks.create(parent.id, 2, { title: 'Private' }),
      () => subtasks.findByTodoId(parent.id, 2), () => subtasks.update(first.id, 2, { completed: true }),
      () => subtasks.delete(first.id, 2), () => todos.update(parent.id, 2, { completed: true }),
      () => todos.delete(parent.id, 2)]) missing(action);
    subtasks.update(first.id, 1, { title: 'Renamed', completed: true });
    assert.equal(todos.findById(parent.id, 1)?.completed, false);
    todos.update(parent.id, 1, { completed: true });
    assert.equal(subtasks.findByTodoId(parent.id, 1)[1].completed, false);
    subtasks.delete(first.id, 1);
    assert.equal(subtasks.findByTodoId(parent.id, 1)[0].position, second.position);
    const third = subtasks.create(parent.id, 1, { title: 'Third' });
    assert.equal(third.position, second.position + 1);
    for (const input of [{ title: ' ' }, { title: 2 }, { completed: 1 }, {}, { user_id: 2 }]) {
      assert.throws(() => subtasks.update(second.id, 1, input as never));
    }
    todos.delete(parent.id, 1);
    assert.equal((database.prepare('SELECT count(*) AS count FROM subtasks').get() as { count: number }).count, 0);
  } finally { database.close(); }
});

test('full todo creation preserves defaults and validates date dependencies and strict fields', () => {
  const { database, todos } = fixture();
  try {
    const basic = todos.create(1, { title: 'Basic' });
    assert.equal(basic.due_date, null);
    assert.equal(basic.priority, 'medium');
    const due = new Date(getSingaporeNow().getTime() + 120_000).toISOString();
    const full = todos.create(1, { title: 'Full', due_date: due, is_recurring: true,
      recurrence_pattern: 'weekly', reminder_minutes: 15, subtasks: [{ title: 'Draft' }] });
    assert.equal(full.due_date, due);
    assert.equal(full.is_recurring, true);
    assert.equal(full.subtasks?.[0].completed, false);
    for (const input of [{ due_date: 'invalid' }, { due_date: '2020-01-01T00:00:00Z' },
      { due_date: new Date(getSingaporeNow().getTime() + 30_000).toISOString() },
      { is_recurring: true, recurrence_pattern: 'daily' }, { reminder_minutes: 15 },
      { due_date: due, reminder_minutes: 7 }, { unknown: true }]) {
      assert.equal(todoInputSchema.safeParse({ title: 'Invalid', ...input }).success, false);
    }
  } finally { database.close(); }
});

test('template snapshots are user scoped, editable and recreate fresh unchecked untagged children', () => {
  const { database, templates, todos } = fixture();
  try {
    const input = { name: 'Weekly', title_template: 'Review', category: 'Work', priority: 'high' as const,
      is_recurring: true, recurrence_pattern: 'weekly' as const, reminder_minutes: 15 as const,
      due_date_offset_minutes: 1, subtasks: [{ title: 'Second', position: 2 }, { title: 'First', position: 0 }] };
    const template = templates.create(1, input);
    templates.create(1, input);
    assert.equal(templates.findAllByUser(1).length, 2);
    assert.deepEqual(templates.findAllByUser(2), []);
    missing(() => templates.use(template.id, 2));
    missing(() => templates.update(template.id, 2, { name: 'Stolen' }));
    missing(() => templates.delete(template.id, 2));
    const before = getSingaporeNow().getTime();
    const first = templates.use(template.id, 1);
    const second = templates.use(template.id, 1);
    assert.ok(Date.parse(first.due_date!) >= before + 60_000);
    assert.ok(Date.parse(first.due_date!) <= getSingaporeNow().getTime() + 60_000);
    assert.deepEqual(first.tags, []);
    assert.equal(first.is_recurring, true);
    assert.equal(first.reminder_minutes, 15);
    assert.deepEqual(first.subtasks?.map((child) => child.title), ['First', 'Second']);
    assert.deepEqual(first.subtasks?.map((child) => child.position), [0, 2]);
    assert.ok(first.subtasks?.every((child) => !child.completed));
    assert.notEqual(first.subtasks?.[0].id, second.subtasks?.[0].id);
    templates.update(template.id, 1, { name: 'Changed', title_template: 'New', subtasks: [] });
    assert.equal(templates.findById(template.id, 1)?.name, 'Changed');
    assert.equal(templates.use(template.id, 1).subtasks?.length, 0);
    templates.delete(template.id, 1);
    assert.equal(todos.findById(first.id, 1)?.title, 'Review');
    missing(() => templates.use(template.id, 1));
  } finally { database.close(); }
});

test('template strict validation and malformed checklist shape fallback', () => {
  for (const value of [null, '', '{', '{}', 'null', '[null]', '[{"title":1,"position":0}]', '[{"title":" ","position":0}]']) {
    assert.deepEqual(parseTemplateSubtasks(value), []);
  }
  assert.deepEqual(parseTemplateSubtasks('[{"title":"Step","position":3}]'), [{ title: 'Step', position: 3 }]);
  for (const input of [{ name: ' ' }, { due_date_offset_minutes: 0 }, { due_date_offset_minutes: -1 },
    { due_date_offset_minutes: 1.5 }, { is_recurring: true }, { reminder_minutes: 15 },
    { tag_ids: [] }, { subtasks: [{ title: ' ' }] }]) {
    assert.equal(templateInputSchema.safeParse({ name: 'Name', title_template: 'Task', ...input }).success, false);
  }
  const { database, templates } = fixture();
  try {
    const template = templates.create(1, { name: 'Plain', title_template: 'Plain' });
    for (const raw of ['{', '{}', '[null]']) {
      database.prepare('UPDATE templates SET subtasks_json = ? WHERE id = ?').run(raw, template.id);
      assert.equal(templates.use(template.id, 1).subtasks?.length, 0);
    }
    assert.equal(templates.use(template.id, 1).due_date, null);
    assert.throws(() => templates.update(template.id, 1, { reminder_minutes: 15 }));
  } finally { database.close(); }
});

test('template use and draft todo creation roll back fully on child insert failure', () => {
  const { database, templates, todos } = fixture();
  try {
    const template = templates.create(1, { name: 'Atomic', title_template: 'Atomic', subtasks: [{ title: 'Fail' }] });
    database.exec("CREATE TRIGGER reject_child BEFORE INSERT ON subtasks BEGIN SELECT RAISE(ABORT, 'child failure'); END");
    assert.throws(() => templates.use(template.id, 1));
    assert.throws(() => todos.create(1, { title: 'Atomic draft', subtasks: [{ title: 'Fail' }] }));
    assert.equal(todos.findAllByUser(1).length, 0);
  } finally { database.close(); }
});

test('partial todo and template updates preserve all omitted schedule, priority, tag and checklist fields', () => {
  const { database, todos, tags, templates } = fixture();
  try {
    const tag = tags.create(1, { name: 'Keep' });
    const schedule = { priority: 'high' as const, is_recurring: true, recurrence_pattern: 'daily' as const, reminder_minutes: 30 as const };
    const todo = todos.create(1, { title: 'Keep', ...schedule, due_date: new Date(getSingaporeNow().getTime() + 120_000).toISOString(), tag_ids: [tag.id], subtasks: [{ title: 'Keep child' }] });
    const changed = todos.update(todo.id, 1, { completed: true });
    assert.deepEqual({ ...changed, completed: false, updated_at: todo.updated_at }, todo);
    const template = templates.create(1, { name: 'Keep', title_template: 'Keep', ...schedule, due_date_offset_minutes: 10, subtasks: [{ title: 'Keep child' }] });
    const edited = templates.update(template.id, 1, { name: 'Renamed' });
    assert.deepEqual({ ...edited, name: template.name }, template);
    assert.throws(() => todos.update(todo.id, 1, { due_date: null }));
    assert.throws(() => todos.update(todo.id, 1, { due_date: '2020-01-01T00:00:00Z' }));
  } finally { database.close(); }
});

test('exported repositories share one lazy database and preserve typed user scoping', () => {
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = ':memory:';
  try {
    const database = getDatabase();
    assert.equal(getDatabase(), database);
    assert.equal(getStore(), getStore());
    database.prepare("INSERT INTO users(id, username) VALUES (10, 'singleton')").run();
    const tag = tagDB.create(10, { name: 'Shared' });
    const todo = todoDB.create(10, { title: 'Shared', tag_ids: [tag.id] });
    const child = subtaskDB.create(todo.id, 10, { title: 'Shared child' });
    const template = templateDB.create(10, { name: 'Shared', title_template: 'Shared' });
    assert.equal(subtaskDB.update(child.id, 10, { completed: true }).completed, true);
    assert.equal(templateDB.use(template.id, 10).title, 'Shared');
    assert.equal(todoDB.findById(todo.id, 10)?.tags?.[0].id, tag.id);
    database.prepare('DELETE FROM users WHERE id = 10').run();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
  }
});

test('relative one-minute deadlines are resolved on the server without a network-delay boundary', () => {
  const { database, todos } = fixture();
  try {
    const before = getSingaporeNow().getTime();
    const todo = todos.create(1, { title: 'One minute', due_date_offset_minutes: 1 } as never);
    assert.ok(Date.parse(todo.due_date!) >= before + 60_000);
    assert.ok(Date.parse(todo.due_date!) <= getSingaporeNow().getTime() + 60_000);
    assert.throws(() => todos.create(1, { title: 'Conflicting date', due_date_offset_minutes: 1,
      due_date: '2030-01-01T00:00:00Z' } as never));
  } finally { database.close(); }
});