import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, loadPresets, savePreset, deletePreset } from '../lib/filters';
import type { Todo } from '../lib/db';
import Database from 'better-sqlite3';
import { createStore, DataError, demoEnabled, tagInputSchema } from '../lib/db';

const todo: Todo = {
  id: 1, user_id: 1, title: 'Team meeting', completed: false,
  due_date: '2026-10-30T18:00:00Z', priority: 'high', is_recurring: false,
  recurrence_pattern: null, reminder_minutes: null, last_notification_sent: null,
  created_at: '2026-10-30T00:00:00Z', updated_at: null,
  subtasks: [{ id: 1, todo_id: 1, title: 'Prepare résumé', completed: false, position: 0 }],
  tags: [{ id: 1, user_id: 1, name: 'Work', color: '#3B82F6', created_at: '' }],
};
const rows = [todo, { ...todo, id: 2, title: 'Groceries', completed: true, priority: 'low' as const, due_date: null, subtasks: [], tags: [] }];

test('search matches titles and subtasks, ignores case and whitespace', () => {
  for (const search of [' MEETING ', 'RÉSUMÉ']) {
    assert.deepEqual(applyFilters(rows, { ...DEFAULT_FILTER_STATE, search }).map((row) => row.id), [1]);
  }
  assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, search: '   ' }).length, 2);
  assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, search: 'missing' }).length, 0);
});

test('each dimension filters independently and combines with AND without changing order', () => {
  for (const filters of [{ priority: 'high' }, { tagId: 1 }, { completion: 'incomplete' }]) {
    assert.deepEqual(applyFilters(rows, { ...DEFAULT_FILTER_STATE, ...filters } as typeof DEFAULT_FILTER_STATE).map((row) => row.id), [1]);
  }
  assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, completion: 'completed' })[0].id, 2);
  const combined = { ...DEFAULT_FILTER_STATE, search: 'meeting', priority: 'high' as const, tagId: 1, completion: 'incomplete' as const, dueDateFrom: '2026-10-31', dueDateTo: '2026-10-31' };
  assert.equal(applyFilters(rows, combined).length, 1);
  assert.equal(applyFilters(rows, { ...combined, priority: 'low' }).length, 0);
  assert.deepEqual(applyFilters(rows, DEFAULT_FILTER_STATE), rows);
});

test('date bounds use Singapore dates, support either bound, and exclude undated todos', () => {
  for (const bounds of [{ dueDateFrom: '2026-10-31' }, { dueDateTo: '2026-10-31' }]) {
    assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, ...bounds }).length, 1);
  }
  assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, dueDateTo: '2026-10-30' }).length, 0);
  assert.equal(applyFilters(rows, { ...DEFAULT_FILTER_STATE, dueDateFrom: '2026-11-02', dueDateTo: '2026-10-31' }).length, 0);
  assert.equal(applyFilters([{ ...todo, due_date: '2026-10-31T02:00:00' }], { ...DEFAULT_FILTER_STATE, dueDateFrom: '2026-10-31' }).length, 1);
});

test('active state detects every dimension', () => {
  assert.equal(hasActiveFilters(DEFAULT_FILTER_STATE), false);
  assert.equal(hasActiveFilters({ ...DEFAULT_FILTER_STATE, search: '  ' }), false);
  for (const delta of [{ search: 'a' }, { priority: 'low' }, { tagId: 1 }, { completion: 'completed' }, { dueDateFrom: '2026-01-01' }, { dueDateTo: '2026-01-01' }]) {
    assert.equal(hasActiveFilters({ ...DEFAULT_FILTER_STATE, ...delta } as typeof DEFAULT_FILTER_STATE), true);
  }
});

test('presets round-trip per account; malformed data and storage failures are handled', () => {
  const map = new Map<string, string>();
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  const preset = { id: 'one', name: 'Focus', filters: DEFAULT_FILTER_STATE, createdAt: '2026-10-30T00:00:00Z' };
  assert.equal(savePreset(1, preset, storage).length, 1);
  assert.equal(loadPresets(2, storage).length, 0);
  assert.deepEqual(loadPresets(1, storage)[0], preset);
  assert.equal(deletePreset(1, 'one', storage).length, 0);
  for (const value of ['{', '{}', '[{}]', '[{"filters":null}]']) {
    map.set('todo-app:filter-presets:1', value);
    assert.deepEqual(loadPresets(1, storage), []);
  }
  assert.throws(() => savePreset(1, preset, { ...storage, setItem() { throw new Error('quota'); } }), /storage is full/);
});

test('filtering 1000 todos stays within 100ms', () => {
  const many = Array.from({ length: 1000 }, (_, index) => ({ ...todo, id: index }));
  const start = performance.now();
  assert.equal(applyFilters(many, { ...DEFAULT_FILTER_STATE, search: 'meeting', dueDateFrom: '2026-10-31' }).length, 1000);
  assert.ok(performance.now() - start < 100);
});

test('tag validation rejects wrong types, blank names and invalid colors', () => {
  for (const input of [{ name: '' }, { name: '  ' }, { name: 7 }, { name: 'Work', color: '' }, { name: 'Work', color: 'red' }, { name: 'Work', color: '#ZZZ' }, { name: 'Work', color: null }]) {
    assert.equal(tagInputSchema.safeParse(input).success, false);
  }
  assert.deepEqual(tagInputSchema.parse({ name: ' Work ' }), { name: 'Work', color: '#3B82F6' });
});

test('demo access is opt-in, development-only, and restricted to the demo database', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, DEMO_MODE: process.env.DEMO_MODE, DATABASE_PATH: process.env.DATABASE_PATH };
  try {
    Object.assign(process.env, { NODE_ENV: 'production', DEMO_MODE: 'true', DATABASE_PATH: 'demo.db' });
    assert.equal(demoEnabled(), false);
    Object.assign(process.env, { NODE_ENV: 'development', DEMO_MODE: 'false' });
    assert.equal(demoEnabled(), false);
    Object.assign(process.env, { DEMO_MODE: 'true', DATABASE_PATH: 'todos.db' });
    assert.equal(demoEnabled(), false);
    process.env.DATABASE_PATH = 'demo.db';
    assert.equal(demoEnabled(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tag CRUD is user-scoped, case-insensitively unique, live, idempotent and cascading', () => {
  const database = new Database(':memory:');
  try {
    const store = createStore(database);
    database.prepare('INSERT INTO users(id, username) VALUES (1, ?), (2, ?)').run('Alice', 'Bob');
    const work = store.tags.create(1, { name: ' Work ' });
    const personal = store.tags.create(1, { name: 'Personal', color: '#FFFFFF' });
    const foreign = store.tags.create(2, { name: 'Work' });
    const task = store.todos.create(1, { title: 'A task', tag_ids: [work.id, personal.id, work.id] });
    const other = store.todos.create(2, { title: 'Private task', tag_ids: [foreign.id] });
    assert.throws(() => store.tags.create(1, { name: 'work' }), (error: unknown) => error instanceof DataError && error.status === 409);
    assert.equal(store.tags.findAllByUser(1).length, 2);
    assert.equal(store.tags.findById(foreign.id, 1), undefined);
    assert.deepEqual(store.tags.findByTodoId(other.id, 1), []);
    for (const action of [
      () => store.tags.update(foreign.id, 1, { name: 'Stolen' }),
      () => store.tags.delete(foreign.id, 1),
      () => store.tags.attachToTodo(task.id, foreign.id, 1),
      () => store.tags.attachToTodo(other.id, work.id, 1),
      () => store.tags.detachFromTodo(other.id, foreign.id, 1),
    ]) assert.throws(action, (error: unknown) => error instanceof DataError && error.status === 404);
    store.tags.attachToTodo(task.id, work.id, 1);
    assert.equal(store.tags.findByTodoId(task.id, 1).length, 2);
    store.tags.update(work.id, 1, { name: 'Office', color: '#000000' });
    assert.equal(store.todos.findAllByUser(1)[0].tags?.find((tag) => tag.id === work.id)?.name, 'Office');
    assert.throws(() => store.tags.update(work.id, 1, { name: 'personal' }), /already exists/);
    store.tags.detachFromTodo(task.id, personal.id, 1);
    store.tags.detachFromTodo(task.id, personal.id, 1);
    store.tags.delete(work.id, 1);
    assert.equal(store.tags.findByTodoId(task.id, 1).length, 0);
    assert.equal(store.tags.findByTodoId(other.id, 2).length, 1);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.throws(() => store.todos.create(1, { title: 'Rollback', tag_ids: [foreign.id] }), /not found/);
    assert.equal(store.todos.findAllByUser(1).length, 1);
  } finally {
    database.close();
  }
});