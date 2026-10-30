import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { todoCreateSchema, todoUpdateSchema } from '@/lib/validation';

export type Priority = 'high' | 'medium' | 'low';
export type TodoCreate = z.infer<typeof todoCreateSchema>;
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;

export interface Subtask {
  id: number;
  title: string;
  completed: boolean;
}

export interface TodoTag {
  id: number;
  name: string;
  color: string;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks: Subtask[];
  tags: TodoTag[];
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export class InvalidTodoTagsError extends Error {}

const databasePath = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'data', 'todos.db');
mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma('foreign_keys = ON');
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS authenticators (
    credential_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
  CREATE TABLE IF NOT EXISTS auth_challenges (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('registration', 'authentication')),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_challenges_user_kind ON auth_challenges(user_id, kind);
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
    is_recurring INTEGER NOT NULL DEFAULT 0 CHECK(is_recurring IN (0, 1)),
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    last_notification_sent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
  CREATE INDEX IF NOT EXISTS idx_todos_user_due_date ON todos(user_id, due_date);
  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    UNIQUE(user_id, name)
  );
  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(todo_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

interface TodoRow extends Omit<Todo, 'completed' | 'is_recurring' | 'subtasks' | 'tags'> {
  completed: number;
  is_recurring: number;
  subtasks_json: string;
  tags_json: string;
}

function fromTodoRow(row: TodoRow): Todo {
  const { subtasks_json, tags_json, ...todo } = row;
  const subtasks = JSON.parse(subtasks_json) as Array<Omit<Subtask, 'completed'> & { completed: number }>;
  return {
    ...todo,
    completed: row.completed === 1,
    is_recurring: row.is_recurring === 1,
    subtasks: subtasks.map((subtask) => ({ ...subtask, completed: subtask.completed === 1 })),
    tags: JSON.parse(tags_json) as TodoTag[],
  };
}

const todoSelect = `SELECT todos.*,
  COALESCE((SELECT json_group_array(json_object('id', subtasks.id, 'title', subtasks.title, 'completed', subtasks.completed))
    FROM subtasks WHERE subtasks.todo_id = todos.id), '[]') AS subtasks_json,
  COALESCE((SELECT json_group_array(json_object('id', tags.id, 'name', tags.name, 'color', tags.color))
    FROM todo_tags JOIN tags ON tags.id = todo_tags.tag_id WHERE todo_tags.todo_id = todos.id), '[]') AS tags_json
  FROM todos`;

export function findUserByUsername(username: string) {
  return database.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(username) as
    { id: number; username: string; display_name: string } | undefined;
}

export function createUser(username: string, displayName: string) {
  const result = database.prepare('INSERT INTO users (username, display_name) VALUES (?, ?)').run(username, displayName);
  return { id: Number(result.lastInsertRowid), username, display_name: displayName };
}

export function listAuthenticators(userId: number) {
  return database.prepare('SELECT credential_id, public_key, counter, transports, device_type, backed_up FROM authenticators WHERE user_id = ?')
    .all(userId) as Array<{ credential_id: string; public_key: string; counter: number; transports: string; device_type: string; backed_up: number }>;
}

export function findAuthenticator(credentialId: string) {
  return database.prepare('SELECT credential_id, user_id, public_key, counter, transports, device_type, backed_up FROM authenticators WHERE credential_id = ?')
    .get(credentialId) as { credential_id: string; user_id: number; public_key: string; counter: number; transports: string; device_type: string; backed_up: number } | undefined;
}

export function addAuthenticator(input: { credentialId: string; userId: number; publicKey: string; counter: number; transports: string[]; deviceType: string; backedUp: boolean }) {
  database.prepare(`INSERT INTO authenticators (credential_id, user_id, public_key, counter, transports, device_type, backed_up)
    VALUES (@credentialId, @userId, @publicKey, @counter, @transports, @deviceType, @backedUp)`)
    .run({ ...input, transports: JSON.stringify(input.transports), backedUp: Number(input.backedUp) });
}

export function updateAuthenticatorCounter(credentialId: string, counter: number, backedUp: boolean) {
  database.prepare('UPDATE authenticators SET counter = ?, backed_up = ? WHERE credential_id = ?')
    .run(counter, Number(backedUp), credentialId);
}

export function saveChallenge(userId: number, challenge: string, kind: 'registration' | 'authentication') {
  database.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(Date.now());
  database.prepare('DELETE FROM auth_challenges WHERE user_id = ? AND kind = ?').run(userId, kind);
  database.prepare('INSERT INTO auth_challenges (user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, challenge, kind, Date.now() + 5 * 60_000);
}

export function consumeChallenge(userId: number, kind: 'registration' | 'authentication') {
  const row = database.prepare('SELECT challenge FROM auth_challenges WHERE user_id = ? AND kind = ? AND expires_at >= ? ORDER BY expires_at DESC LIMIT 1')
    .get(userId, kind, Date.now()) as { challenge: string } | undefined;
  database.prepare('DELETE FROM auth_challenges WHERE user_id = ? AND kind = ?').run(userId, kind);
  return row?.challenge;
}

export function listTodos(userId: number): Todo[] {
  const rows = database.prepare(`${todoSelect} WHERE todos.user_id = ?`).all(userId) as TodoRow[];
  return rows.map(fromTodoRow);
}

export function findTodo(userId: number, todoId: number): Todo | undefined {
  const row = database.prepare(`${todoSelect} WHERE todos.user_id = ? AND todos.id = ?`).get(userId, todoId) as TodoRow | undefined;
  return row ? fromTodoRow(row) : undefined;
}

export function insertTodo(userId: number, input: TodoCreate): Todo {
  const insert = database.transaction(() => {
    const result = database.prepare(`INSERT INTO todos
      (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
      VALUES (@userId, @title, @dueDate, @priority, @isRecurring, @recurrencePattern, @reminderMinutes)`)
      .run({
        userId,
        title: input.title,
        dueDate: input.due_date ?? null,
        priority: input.priority,
        isRecurring: Number(input.is_recurring),
        recurrencePattern: input.recurrence_pattern ?? null,
        reminderMinutes: input.reminder_minutes ?? null,
      });
    const todoId = Number(result.lastInsertRowid);
    const tagIds = [...new Set(input.tag_ids ?? [])];
    const findOwnedTag = database.prepare('SELECT 1 FROM tags WHERE id = ? AND user_id = ?');
    const insertTodoTag = database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)');
    for (const tagId of tagIds) {
      if (!findOwnedTag.get(tagId, userId)) throw new InvalidTodoTagsError('One or more tags are unavailable.');
      insertTodoTag.run(todoId, tagId);
    }
    return findTodo(userId, todoId)!;
  });
  return insert();
}

const updateColumns: Record<keyof TodoUpdate, string> = {
  title: 'title',
  due_date: 'due_date',
  priority: 'priority',
  is_recurring: 'is_recurring',
  recurrence_pattern: 'recurrence_pattern',
  reminder_minutes: 'reminder_minutes',
  completed: 'completed',
};

export function updateTodo(userId: number, todoId: number, input: TodoUpdate): Todo | undefined {
  const entries = Object.entries(input).filter(([key]) => key in updateColumns);
  if (entries.length === 0) return findTodo(userId, todoId);

  const assignments = entries.map(([key]) => `${updateColumns[key as keyof TodoUpdate]} = @${key}`);
  assignments.push("updated_at = datetime('now')");
  const values = Object.fromEntries(entries.map(([key, value]) => [
    key,
    key === 'completed' || key === 'is_recurring' ? Number(value) : value,
  ]));
  database.prepare(`UPDATE todos SET ${assignments.join(', ')} WHERE user_id = @userId AND id = @todoId`)
    .run({ ...values, userId, todoId });
  return findTodo(userId, todoId);
}

export function deleteTodo(userId: number, todoId: number): boolean {
  return database.prepare('DELETE FROM todos WHERE user_id = ? AND id = ?').run(userId, todoId).changes > 0;
}

export function findHolidays(startDate?: string, endDateExclusive?: string): Holiday[] {
  if (startDate && endDateExclusive) {
    return database.prepare('SELECT id, date, name FROM holidays WHERE date >= ? AND date < ? ORDER BY date')
      .all(startDate, endDateExclusive) as Holiday[];
  }
  return database.prepare('SELECT id, date, name FROM holidays ORDER BY date').all() as Holiday[];
}

export function upsertHoliday(date: string, name: string) {
  database.prepare('INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name')
    .run(date, name);
}