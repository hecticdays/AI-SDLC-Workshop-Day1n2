import Database from 'better-sqlite3';
import { test, expect, createTag, createTodo } from './helpers';
import type { Todo } from '../lib/db';

function taskRow(page: import('@playwright/test').Page, title: string) {
  return page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

test('API creates, reads, updates and deletes todos with validation and ownership', async ({ request, account }) => {
  const created = await request.post('/api/todos', { data: { title: '  Title only  ' } });
  expect(created.status()).toBe(201);
  const todo: Todo = await created.json();
  expect(todo).toMatchObject({ title: 'Title only', priority: 'medium', completed: false, due_date: null, is_recurring: false, reminder_minutes: null });

  for (const data of [{ title: '   ' }, { title: 42 }, {}, { title: 'Valid', unexpected: true }]) {
    expect((await request.post('/api/todos', { data })).status()).toBe(400);
  }
  expect((await request.post('/api/todos', { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);

  const listed: Todo[] = await (await request.get('/api/todos')).json();
  expect(listed.some((item) => item.id === todo.id)).toBe(true);
  expect(listed.some((item) => item.id === account.foreignTodo)).toBe(false);

  expect((await request.get(`/api/todos/${todo.id}`)).status()).toBe(200);
  expect((await request.get(`/api/todos/${account.foreignTodo}`)).status()).toBe(404);
  expect((await request.get('/api/todos/not-a-number')).status()).toBe(400);

  const updated = await request.put(`/api/todos/${todo.id}`, { data: { title: 'Renamed todo' } });
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ title: 'Renamed todo', priority: 'medium' });
  expect((await request.put(`/api/todos/${todo.id}`, { data: { title: ' ' } })).status()).toBe(400);
  expect((await request.put(`/api/todos/${todo.id}`, { data: {} })).status()).toBe(400);
  expect((await request.put(`/api/todos/${account.foreignTodo}`, { data: { title: 'Stolen' } })).status()).toBe(404);

  expect((await request.delete(`/api/todos/${account.foreignTodo}`)).status()).toBe(404);
  expect((await request.delete(`/api/todos/${todo.id}`)).status()).toBe(204);
  expect((await request.get(`/api/todos/${todo.id}`)).status()).toBe(404);
});

test('create todo with all metadata persists priority, due date, recurrence, reminder, tags and subtasks', async ({ request }) => {
  const tag = await createTag(request, 'Metadata');
  const due = '2030-03-04T10:30:00+08:00';
  const response = await request.post('/api/todos', { data: {
    title: 'Fully described', priority: 'high', due_date: due, is_recurring: true, recurrence_pattern: 'monthly',
    reminder_minutes: 60, tag_ids: [tag.id], subtasks: [{ title: 'First' }, { title: 'Second' }],
  } });
  expect(response.status()).toBe(201);
  const todo: Todo = await response.json();
  expect(todo).toMatchObject({ priority: 'high', is_recurring: true, recurrence_pattern: 'monthly', reminder_minutes: 60 });
  expect(Date.parse(todo.due_date!)).toBe(Date.parse(due));
  expect(todo.tags?.map((assigned) => assigned.id)).toEqual([tag.id]);
  expect(todo.subtasks?.map((child) => child.title)).toEqual(['First', 'Second']);
});

test('UI creates, edits, completes, reopens and deletes a todo with confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New task title').fill('UI lifecycle todo');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const pending = page.getByRole('region', { name: 'Pending', exact: true });
  await expect(taskRow(page, 'UI lifecycle todo')).toBeVisible();
  await expect(pending.getByRole('heading', { name: 'UI lifecycle todo', exact: true })).toBeVisible();
  await expect(page.getByLabel('New task title')).toHaveValue('');

  await page.getByRole('button', { name: 'Edit UI lifecycle todo', exact: true }).click();
  await page.getByLabel('Edit todo title').fill('UI lifecycle edited');
  await page.getByLabel('Edit todo priority').selectOption('high');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(taskRow(page, 'UI lifecycle edited')).toBeVisible();
  await expect(taskRow(page, 'UI lifecycle todo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Complete task UI lifecycle edited', exact: true }).click();
  const completed = page.getByRole('region', { name: 'Completed', exact: true });
  await expect(completed.getByRole('heading', { name: 'UI lifecycle edited', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen task UI lifecycle edited', exact: true }).click();
  await expect(pending.getByRole('heading', { name: 'UI lifecycle edited', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete task UI lifecycle edited', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete todo?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(taskRow(page, 'UI lifecycle edited')).toBeVisible();
  await page.getByRole('button', { name: 'Delete task UI lifecycle edited', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete todo?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(taskRow(page, 'UI lifecycle edited')).toHaveCount(0);
});

test('todos are displayed in Overdue, Pending and Completed sections', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Overdue', exact: true }).getByRole('heading', { name: 'Old paperwork', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending', exact: true }).getByRole('heading', { name: 'Team meeting', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Completed', exact: true }).getByRole('heading', { name: 'Send report', exact: true })).toBeVisible();
});

test('failed creation rolls back the optimistic row and keeps the title for retry', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/todos', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 500, json: { error: 'Please retry creating the task' } }) : route.continue(), { times: 1 });
  await page.getByLabel('New task title').fill('Optimistic rollback');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Please retry creating the task' })).toBeVisible();
  await expect(taskRow(page, 'Optimistic rollback')).toHaveCount(0);
  await expect(page.getByLabel('New task title')).toHaveValue('Optimistic rollback');
});

test('deleting a todo cascades to its subtasks and tag associations', async ({ request }) => {
  const tag = await createTag(request, 'Cascade');
  const todo = await createTodo(request, 'Cascade parent', [tag.id]);
  expect((await request.post(`/api/todos/${todo.id}/subtasks`, { data: { title: 'Child' } })).status()).toBe(201);
  expect((await request.delete(`/api/todos/${todo.id}`)).status()).toBe(204);
  const database = new Database(process.env.PERSON4_TEST_DATABASE!, { readonly: true });
  try {
    expect(database.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?').get(todo.id)).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?').get(todo.id)).toMatchObject({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM tags WHERE id = ?').get(tag.id)).toMatchObject({ count: 1 });
  } finally { database.close(); }
});
