import { test, expect, createTag } from './helpers';
import type { APIRequestContext } from '@playwright/test';
import type { RecurrencePattern, Todo } from '../lib/db';

// 2030-01-31 10:00 Singapore time; month-end exercises monthly clamping.
const ANCHOR = '2030-01-31T10:00:00+08:00';

async function createRecurring(request: APIRequestContext, title: string, pattern: RecurrencePattern, extra: Record<string, unknown> = {}) {
  const response = await request.post('/api/todos', { data: {
    title, due_date: ANCHOR, is_recurring: true, recurrence_pattern: pattern, ...extra,
  } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<Todo>;
}

async function todosTitled(request: APIRequestContext, title: string): Promise<Todo[]> {
  const todos: Todo[] = await (await request.get('/api/todos')).json();
  return todos.filter((todo) => todo.title === title);
}

test('recurring todos require a due date and a valid pattern', async ({ request }) => {
  for (const data of [
    { title: 'No date', is_recurring: true, recurrence_pattern: 'daily' },
    { title: 'No pattern', is_recurring: true, due_date: ANCHOR },
    { title: 'Bad pattern', is_recurring: true, recurrence_pattern: 'hourly', due_date: ANCHOR },
    { title: 'Pattern only', is_recurring: false, recurrence_pattern: 'weekly', due_date: ANCHOR },
  ]) {
    expect((await request.post('/api/todos', { data })).status()).toBe(400);
  }
});

const expectedNext: Record<RecurrencePattern, string> = {
  daily: '2030-02-01T10:00:00+08:00',
  weekly: '2030-02-07T10:00:00+08:00',
  monthly: '2030-02-28T10:00:00+08:00',
  yearly: '2031-01-31T10:00:00+08:00',
};

for (const pattern of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
  test(`completing a ${pattern} todo creates the next instance with the correct Singapore due date`, async ({ request }) => {
    const title = `Recurring ${pattern}`;
    const todo = await createRecurring(request, title, pattern);
    expect((await request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).status()).toBe(200);
    const instances = await todosTitled(request, title);
    expect(instances).toHaveLength(2);
    const next = instances.find((item) => item.id !== todo.id)!;
    expect(next.completed).toBe(false);
    expect(Date.parse(next.due_date!)).toBe(Date.parse(expectedNext[pattern]));
  });
}

test('next instance inherits priority, tags, reminder, pattern and a fresh checklist', async ({ request }) => {
  const tag = await createTag(request, 'Recurring tag');
  const todo = await createRecurring(request, 'Inherit metadata', 'weekly', {
    priority: 'high', reminder_minutes: 1440, tag_ids: [tag.id], subtasks: [{ title: 'Checklist item' }],
  });
  const [child] = todo.subtasks!;
  expect((await request.put(`/api/subtasks/${child.id}`, { data: { completed: true } })).status()).toBe(200);
  expect((await request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).status()).toBe(200);
  const next = (await todosTitled(request, 'Inherit metadata')).find((item) => item.id !== todo.id)!;
  expect(next).toMatchObject({ priority: 'high', reminder_minutes: 1440, is_recurring: true, recurrence_pattern: 'weekly', last_notification_sent: null });
  expect(next.tags?.map((assigned) => assigned.id)).toEqual([tag.id]);
  expect(next.subtasks?.map(({ title, completed }) => ({ title, completed }))).toEqual([{ title: 'Checklist item', completed: false }]);
});

test('reopening and completing again does not create a duplicate successor', async ({ request }) => {
  const todo = await createRecurring(request, 'No duplicates', 'daily');
  await request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  await request.put(`/api/todos/${todo.id}`, { data: { completed: false } });
  await request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  expect(await todosTitled(request, 'No duplicates')).toHaveLength(2);
});

test('recurring can be disabled on an existing todo so completion creates no successor', async ({ request }) => {
  const todo = await createRecurring(request, 'Stop repeating', 'monthly');
  const disabled = await request.put(`/api/todos/${todo.id}`, { data: { is_recurring: false, recurrence_pattern: null } });
  expect(disabled.status()).toBe(200);
  expect(await disabled.json()).toMatchObject({ is_recurring: false, recurrence_pattern: null });
  await request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  expect(await todosTitled(request, 'Stop repeating')).toHaveLength(1);
});

test('UI creates a weekly recurring todo with a 🔄 badge and completing it shows the next instance', async ({ page }) => {
  const local = new Date(Date.now() + 8 * 3_600_000 + 2 * 86_400_000).toISOString().slice(0, 16);
  await page.goto('/');
  await page.getByLabel('New task title').fill('Weekly review');
  await page.getByLabel('New task due date').fill(local);
  await page.getByLabel('New task recurrence').selectOption('weekly');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const rows = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Weekly review', exact: true }) });
  await expect(rows.first().getByText('🔄 Repeats weekly')).toBeVisible();

  await rows.first().getByRole('button', { name: 'Complete task Weekly review', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Completed', exact: true }).getByRole('heading', { name: 'Weekly review', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending', exact: true }).getByText('🔄 Repeats weekly')).toBeVisible();
});

test('UI edit modal turns Repeat off and changes the pattern', async ({ page, request }) => {
  const todo = await createRecurring(request, 'Edit repeat', 'daily');
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Edit repeat', exact: true }).click();
  await page.getByLabel('Edit todo recurrence pattern').selectOption('yearly');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Edit repeat', exact: true }) });
  await expect(row.getByText('🔄 Repeats yearly')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Edit repeat', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Repeat' }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByText(/Repeats/)).toHaveCount(0);
  expect(await (await request.get(`/api/todos/${todo.id}`)).json()).toMatchObject({ is_recurring: false, recurrence_pattern: null });
});
