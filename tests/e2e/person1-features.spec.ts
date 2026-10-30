import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('passkey onboarding, todo CRUD, priority filter, and calendar navigation', async ({ page, context, browserName }) => {
  test.setTimeout(30_000);
  test.skip(browserName !== 'chromium', 'The WebAuthn virtual authenticator uses Chromium CDP.');
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });

  await page.goto('/login');
  expect((await page.request.get('/api/todos')).status()).toBe(401);
  const username = `person1-${Date.now()}`;
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible({ timeout: 20_000 });

  const singaporeTomorrow = new Date(Date.now() + 8 * 60 * 60 * 1000 + 48 * 60 * 60 * 1000)
    .toISOString().slice(0, 16);
  const dueDate = singaporeTomorrow.slice(0, 10);
  await page.getByLabel('New task title').fill('Prepare evaluation demo');
  await page.getByLabel('New task priority').selectOption('high');
  await page.getByLabel('New task due date').fill(singaporeTomorrow);
  await page.getByLabel('New task recurrence').selectOption('weekly');
  await page.getByLabel('New task reminder').selectOption('60');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Prepare evaluation demo')).toBeVisible();
  await expect(page.getByText('Repeats weekly')).toBeVisible();
  await expect(page.getByText('Reminder set')).toBeVisible();

  const created = await page.request.get('/api/todos');
  expect(created.ok()).toBe(true);
  const createdBody = await created.json();
  const persistedTodo = createdBody[0];
  expect(persistedTodo).toMatchObject({
    title: 'Prepare evaluation demo', priority: 'high', is_recurring: true,
    recurrence_pattern: 'weekly', reminder_minutes: 60,
  });
  expect(persistedTodo.due_date).toBeTruthy();
  expect((await page.request.get(`/api/todos/${persistedTodo.id}`)).status()).toBe(200);
  const databasePath = process.env.PERSON4_TEST_DATABASE ?? resolve('.person4-e2e.db');
  const relatedDb = new Database(databasePath);
  const tagId = Number(relatedDb.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(persistedTodo.user_id, 'e2e-tag').lastInsertRowid);
  relatedDb.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(persistedTodo.id, tagId);
  relatedDb.prepare('INSERT INTO subtasks (todo_id, title) VALUES (?, ?)').run(persistedTodo.id, 'Cascade check');
  relatedDb.close();
  const relatedTodos = await page.request.get('/api/todos');
  const relatedTodo = (await relatedTodos.json()).find((todo: { id: number }) => todo.id === persistedTodo.id);
  expect(relatedTodo.tags[0]).toMatchObject({ id: tagId, name: 'e2e-tag', color: '#3B82F6' });
  expect(relatedTodo.subtasks).toHaveLength(1);
  const defaultPriority = await page.request.post('/api/todos', { data: { title: 'Default priority check' } });
  const defaultPriorityBody = await defaultPriority.json();
  expect(defaultPriorityBody.priority).toBe('medium');
  await page.request.delete(`/api/todos/${defaultPriorityBody.id}`);

  const invalidPriority = await page.request.post('/api/todos', { data: { title: 'Bad priority', priority: 'urgent' } });
  expect(invalidPriority.status()).toBe(400);
  const malformedDueDate = await page.request.post('/api/todos', { data: { title: 'Malformed date', due_date: 'not-a-date' } });
  expect(malformedDueDate.status()).toBe(400);
  const pastDue = await page.request.post('/api/todos', { data: { title: 'Past due', due_date: '2020-01-01T00:00:00.000Z' } });
  expect(pastDue.status()).toBe(400);
  const invalidRecurring = await page.request.post('/api/todos', { data: { title: 'No recurrence date', is_recurring: true } });
  expect(invalidRecurring.status()).toBe(400);
  const invalidUpdate = await page.request.put(`/api/todos/${persistedTodo.id}`, { data: { due_date: '2020-01-01T00:00:00.000Z' } });
  expect(invalidUpdate.status()).toBe(400);

  await page.getByRole('button', { name: 'Edit Prepare evaluation demo' }).click();
  await page.getByLabel('Edit todo title').fill('Discarded edit');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Prepare evaluation demo')).toBeVisible();
  await page.getByRole('button', { name: 'Edit Prepare evaluation demo' }).click();
  await page.getByLabel('Edit todo title').fill('Prepare evaluation demo revised');
  await page.getByLabel('Edit todo priority').selectOption('low');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Prepare evaluation demo revised')).toBeVisible();

  await page.getByLabel('Filter by priority').selectOption('high');
  await expect(page.getByText('Prepare evaluation demo revised')).toHaveCount(0);
  await page.getByLabel('Filter by priority').selectOption('low');
  await expect(page.getByText('Prepare evaluation demo revised')).toBeVisible();
  await page.getByLabel('Filter by priority').selectOption('all');
  await expect(page.getByText('Prepare evaluation demo revised')).toBeVisible();

  await page.getByRole('button', { name: 'Complete task Prepare evaluation demo revised', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Completed' }).getByText('Prepare evaluation demo revised')).toBeVisible();
  await page.getByRole('region', { name: 'Completed', exact: true }).getByRole('button', { name: 'Delete task Prepare evaluation demo revised', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete todo?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('region', { name: 'Completed', exact: true }).getByText('Prepare evaluation demo revised')).toBeVisible();

  await page.getByRole('link', { name: /calendar/i }).click();
  await expect(page.getByRole('grid', { name: 'Monthly calendar' })).toBeVisible();
  await page.goto('/calendar?month=2026-13');
  const currentMonthLabel = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', month: 'long', year: 'numeric',
  }).format(new Date());
  await expect(page.getByRole('heading', { name: currentMonthLabel })).toBeVisible();
  await page.goto('/calendar?month=2028-02');
  await expect(page.getByRole('heading', { name: 'February 2028' })).toBeVisible();
  await expect(page.getByRole('gridcell', { name: /2028-02-29/ })).toBeVisible();
  await page.goto(`/calendar?month=${dueDate.slice(0, 7)}`);
  await expect(page.getByRole('grid', { name: 'Monthly calendar' })).toBeVisible();
  await page.getByRole('gridcell', { name: new RegExp(`${dueDate}.*1 tasks`) }).click();
  await expect(page.getByRole('dialog').getByText('Prepare evaluation demo revised')).toBeVisible();
  await page.getByRole('button', { name: 'Close day details' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);

  await page.getByRole('link', { name: 'Tasks' }).click();
  await page.getByRole('region', { name: 'Completed', exact: true }).getByRole('button', { name: 'Delete task Prepare evaluation demo revised', exact: true }).click();
  const deleteResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'DELETE' && response.url().endsWith(`/api/todos/${persistedTodo.id}`));
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleteResponsePromise).status()).toBe(204);
  await expect(page.getByRole('region', { name: 'Completed', exact: true }).getByText('Prepare evaluation demo revised')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pending', exact: true }).getByText('Prepare evaluation demo revised', { exact: true })).toBeVisible();
  const cascadeDb = new Database(databasePath);
  expect(cascadeDb.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?').get(persistedTodo.id)).toMatchObject({ count: 0 });
  expect(cascadeDb.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?').get(persistedTodo.id)).toMatchObject({ count: 0 });
  cascadeDb.close();

  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const unauthenticatedTodos = await page.request.get('/api/todos');
  expect(unauthenticatedTodos.status()).toBe(401);
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login$/);
});