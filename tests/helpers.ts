import { test as base, expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createStore, type Tag, type Todo } from '../lib/db';

export const test = base.extend<{ account: { userId: number; foreignTag: number; foreignTodo: number } }>({
  request: async ({ context }, provide) => { await provide(context.request); },
  account: [async ({ context }, provide) => {
    const database = new Database(process.env.PERSON4_TEST_DATABASE!);
    database.pragma('journal_mode = WAL');
    const store = createStore(database);
    const username = `person4-e2e-${randomUUID()}`;
    const userId = Number(database.prepare('INSERT INTO users(username) VALUES (?)').run(username).lastInsertRowid);
    const otherId = Number(database.prepare('INSERT INTO users(username) VALUES (?)').run(`${username}-other`).lastInsertRowid);
    const work = store.tags.create(userId, { name: 'Work', color: '#2563EB' });
    store.tags.create(userId, { name: 'Personal', color: '#0F766E' });
    const meeting = store.todos.create(userId, { title: 'Team meeting', priority: 'high', tag_ids: [work.id] });
    database.prepare('UPDATE todos SET due_date = ? WHERE id = ?').run('2030-01-02T18:00:00Z', meeting.id);
    database.prepare('INSERT INTO subtasks(todo_id, title) VALUES (?, ?)').run(meeting.id, 'Prepare presentation');
    store.todos.create(userId, { title: 'Buy groceries', priority: 'low' });
    const completed = store.todos.create(userId, { title: 'Send report', priority: 'medium' });
    database.prepare('UPDATE todos SET completed = 1 WHERE id = ?').run(completed.id);
    const overdue = store.todos.create(userId, { title: 'Old paperwork', priority: 'low' });
    database.prepare('UPDATE todos SET due_date = ? WHERE id = ?').run('2020-01-01T00:00:00Z', overdue.id);
    const foreignTag = store.tags.create(otherId, { name: 'Private' }).id;
    const foreignTodo = store.todos.create(otherId, { title: 'Confidential', tag_ids: [foreignTag] }).id;
    const token = await new SignJWT({ userId, username }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('person4-test-only-secret-not-for-deployment-0000'));
    await context.addCookies([{ name: 'session', value: token, url: 'http://127.0.0.1:3107', httpOnly: true, sameSite: 'Lax' }]);
    try { await provide({ userId, foreignTag, foreignTodo }); }
    finally {
      database.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userId, otherId);
      database.close();
    }
  }, { auto: true }],
});

export { expect };

export async function createTag(request: APIRequestContext, name: string, color = '#3B82F6'): Promise<Tag> {
  const response = await request.post('/api/tags', { data: { name, color } });
  expect(response.status()).toBe(201);
  return response.json();
}

export async function createTodo(request: APIRequestContext, title: string, tagIds: number[] = []): Promise<Todo> {
  const response = await request.post('/api/todos', { data: { title, tag_ids: tagIds } });
  expect(response.status()).toBe(201);
  return response.json();
}