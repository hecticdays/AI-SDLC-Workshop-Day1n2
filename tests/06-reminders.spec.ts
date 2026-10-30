import { test, expect } from './helpers';
import type { Todo } from '../lib/db';

const REMINDER_OPTIONS = [15, 30, 60, 120, 1440, 2880, 10080];

test('API accepts all seven reminder timings and rejects invalid or undated reminders', async ({ request }) => {
  for (const reminder_minutes of REMINDER_OPTIONS) {
    const response = await request.post('/api/todos', { data: { title: `Reminder ${reminder_minutes}`, due_date_offset_minutes: 20_000, reminder_minutes } });
    expect(response.status()).toBe(201);
    expect((await response.json()).reminder_minutes).toBe(reminder_minutes);
  }
  for (const data of [
    { title: 'No due date', reminder_minutes: 60 },
    { title: 'Unsupported timing', due_date_offset_minutes: 600, reminder_minutes: 45 },
    { title: 'String timing', due_date_offset_minutes: 600, reminder_minutes: '60' },
  ]) {
    expect((await request.post('/api/todos', { data })).status()).toBe(400);
  }
});

test('notification check returns due reminders once and ignores reminders not yet due', async ({ request }) => {
  const dueSoon: Todo = await (await request.post('/api/todos', { data: { title: 'Reminder due now', due_date_offset_minutes: 10, reminder_minutes: 15 } })).json();
  await request.post('/api/todos', { data: { title: 'Reminder later', due_date_offset_minutes: 120, reminder_minutes: 15 } });

  const first = await request.get('/api/notifications/check');
  expect(first.status()).toBe(200);
  const { todos } = await first.json() as { todos: Todo[] };
  expect(todos.map((todo) => todo.title)).toEqual(['Reminder due now']);
  expect(todos[0].last_notification_sent).not.toBeNull();

  const second = await (await request.get('/api/notifications/check')).json() as { todos: Todo[] };
  expect(second.todos).toHaveLength(0);

  // Changing the reminder timing resets duplicate prevention so the new reminder can fire.
  const changed = await request.put(`/api/todos/${dueSoon.id}`, { data: { reminder_minutes: 30 } });
  expect((await changed.json()).last_notification_sent).toBeNull();
  const third = await (await request.get('/api/notifications/check')).json() as { todos: Todo[] };
  expect(third.todos.map((todo) => todo.id)).toEqual([dueSoon.id]);
});

test('completed todos do not trigger reminders', async ({ request }) => {
  const todo: Todo = await (await request.post('/api/todos', { data: { title: 'Already done', due_date_offset_minutes: 5, reminder_minutes: 15 } })).json();
  await request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  const { todos } = await (await request.get('/api/notifications/check')).json() as { todos: Todo[] };
  expect(todos.some((item) => item.id === todo.id)).toBe(false);
});

test('notification check requires authentication', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3107' });
  try {
    expect((await anonymous.get('/api/notifications/check')).status()).toBe(401);
  } finally { await anonymous.dispose(); }
});

test('reminder dropdown is disabled without a due date and lists seven timings', async ({ page }) => {
  await page.goto('/');
  const reminder = page.getByLabel('New task reminder');
  await expect(reminder).toBeDisabled();
  await page.getByLabel('New task due date').fill(new Date(Date.now() + 8 * 3_600_000 + 3 * 86_400_000).toISOString().slice(0, 16));
  await expect(reminder).toBeEnabled();
  const values = await reminder.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
  expect(values.map(Number)).toEqual(REMINDER_OPTIONS);
});

test('setting a reminder shows the 🔔 badge with its timing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New task title').fill('Reminder badge');
  await page.getByLabel('New task due date').fill(new Date(Date.now() + 8 * 3_600_000 + 3 * 86_400_000).toISOString().slice(0, 16));
  await page.getByLabel('New task reminder').selectOption('1440');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Reminder badge', exact: true }) });
  await expect(row.getByLabel('Reminder 1d before due')).toHaveText('🔔 1d');

  await row.getByRole('button', { name: 'Edit Reminder badge', exact: true }).click();
  await page.getByLabel('Edit todo reminder').selectOption('15');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByLabel('Reminder 15m before due')).toBeVisible();
});

test('Enable Notifications requests permission and granted permission starts polling', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enable Notifications' })).toBeVisible();

  await context.grantPermissions(['notifications']);
  const poll = page.waitForResponse((response) => response.url().endsWith('/api/notifications/check'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notifications On' })).toBeDisabled();
  expect((await poll).status()).toBe(200);
});
