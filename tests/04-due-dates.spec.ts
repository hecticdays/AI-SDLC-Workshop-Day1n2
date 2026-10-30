import { test, expect, createTodo } from './helpers';
import type { Todo } from '../lib/db';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A Singapore wall-clock value for datetime-local inputs, `days` from now. */
function singaporeLocal(days: number): string {
  return new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 16);
}

test('API rejects past and less-than-one-minute due dates on create and update', async ({ request }) => {
  for (const due_date of ['2020-01-01T00:00:00Z', new Date(Date.now() + 30_000).toISOString(), 'not-a-date']) {
    expect((await request.post('/api/todos', { data: { title: 'Bad due date', due_date } })).status()).toBe(400);
  }
  const relative = await request.post('/api/todos', { data: { title: 'One minute ahead', due_date_offset_minutes: 1 } });
  expect(relative.status()).toBe(201);
  expect((await request.post('/api/todos', { data: { title: 'Both', due_date: '2030-01-01T00:00:00Z', due_date_offset_minutes: 5 } })).status()).toBe(400);

  const todo = await createTodo(request, 'Reschedule me');
  expect((await request.put(`/api/todos/${todo.id}`, { data: { due_date: '2020-01-01T00:00:00Z' } })).status()).toBe(400);
  const future = await request.put(`/api/todos/${todo.id}`, { data: { due_date: '2030-06-01T09:00:00+08:00' } });
  expect(future.status()).toBe(200);
  expect(Date.parse((await future.json()).due_date)).toBe(Date.parse('2030-06-01T01:00:00Z'));
  const cleared = await request.put(`/api/todos/${todo.id}`, { data: { due_date: null } });
  expect((await cleared.json()).due_date).toBeNull();
});

test('a due date entered in the UI is interpreted and displayed in Singapore time', async ({ page, request }) => {
  const local = singaporeLocal(3);
  await page.goto('/');
  await page.getByLabel('New task title').fill('Singapore deadline');
  await page.getByLabel('New task due date').fill(local);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Singapore deadline', exact: true }) });
  const expected = `${Number(local.slice(8, 10))} ${MONTHS[Number(local.slice(5, 7)) - 1]}, ${local.slice(11, 16)}`;
  await expect(row.locator('time')).toHaveText(expected);

  const todos: Todo[] = await (await request.get('/api/todos')).json();
  const saved = todos.find((todo) => todo.title === 'Singapore deadline')!;
  expect(Date.parse(saved.due_date!)).toBe(Date.parse(`${local}:00+08:00`));
});

test('editing the due date in the modal persists the new Singapore time', async ({ page, request }) => {
  const todo = await createTodo(request, 'Move my deadline');
  const local = singaporeLocal(5);
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Move my deadline', exact: true }).click();
  await page.getByLabel('Edit todo due date').fill(local);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await (await request.get(`/api/todos/${todo.id}`)).json()).due_date)
    .not.toBeNull();
  const saved: Todo = await (await request.get(`/api/todos/${todo.id}`)).json();
  expect(Date.parse(saved.due_date!)).toBe(Date.parse(`${local}:00+08:00`));
});

test('overdue todos appear in the Overdue section and undated todos stay pending', async ({ page }) => {
  await page.goto('/');
  const overdue = page.getByRole('region', { name: 'Overdue', exact: true });
  await expect(overdue.getByRole('heading', { name: 'Old paperwork', exact: true })).toBeVisible();
  await expect(overdue.getByRole('heading', { name: 'Buy groceries', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pending', exact: true }).getByRole('heading', { name: 'Buy groceries', exact: true })).toBeVisible();
});
