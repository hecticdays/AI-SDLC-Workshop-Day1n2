import { test, expect, createTodo } from './helpers';
import type { Priority, Todo } from '../lib/db';

const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

test('API accepts each priority, defaults to medium and rejects invalid values', async ({ request }) => {
  for (const priority of ['high', 'medium', 'low'] as const) {
    const response = await request.post('/api/todos', { data: { title: `Priority ${priority}`, priority } });
    expect(response.status()).toBe(201);
    expect((await response.json()).priority).toBe(priority);
  }
  expect((await createTodo(request, 'Default priority')).priority).toBe('medium');
  for (const priority of ['urgent', 'HIGH', null, 1]) {
    expect((await request.post('/api/todos', { data: { title: 'Bad priority', priority } })).status()).toBe(400);
  }
  const todo = await createTodo(request, 'Change priority');
  const updated = await request.put(`/api/todos/${todo.id}`, { data: { priority: 'low' } });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).priority).toBe('low');
  expect((await request.put(`/api/todos/${todo.id}`, { data: { priority: 'critical' } })).status()).toBe(400);
});

test('todos are sorted high, medium, low and then by due date', async ({ request }) => {
  await request.post('/api/todos', { data: { title: 'Later high', priority: 'high', due_date: '2031-05-01T09:00:00+08:00' } });
  await request.post('/api/todos', { data: { title: 'Sooner high', priority: 'high', due_date: '2030-01-01T09:00:00+08:00' } });
  await request.post('/api/todos', { data: { title: 'Medium task', priority: 'medium' } });
  const todos: Todo[] = await (await request.get('/api/todos')).json();
  const ranks = todos.map((todo) => rank[todo.priority]);
  expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  const titles = todos.map((todo) => todo.title);
  expect(titles.indexOf('Sooner high')).toBeLessThan(titles.indexOf('Later high'));
  expect(titles.indexOf('Later high')).toBeLessThan(titles.indexOf('Medium task'));
});

test('UI creates a todo with each priority and shows a color-coded badge', async ({ page }) => {
  await page.goto('/');
  for (const priority of ['high', 'medium', 'low'] as const) {
    await page.getByLabel('New task title').fill(`Badge ${priority}`);
    await page.getByLabel('New task priority').selectOption(priority);
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: `Badge ${priority}`, exact: true }) });
    await expect(row.locator(`.priority.${priority}`)).toHaveText(priority);
  }
  const colors = await Promise.all((['high', 'medium', 'low'] as const).map((priority) =>
    page.getByTestId('task-row').filter({ hasText: `Badge ${priority}` }).locator(`.priority.${priority} > span`)
      .evaluate((element) => getComputedStyle(element).backgroundColor)));
  expect(new Set(colors).size).toBe(3);
});

test('UI edits priority and filters by priority', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit Buy groceries', exact: true }).click();
  await page.getByLabel('Edit todo priority').selectOption('high');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const groceries = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Buy groceries', exact: true }) });
  await expect(groceries.locator('.priority.high')).toBeVisible();

  await page.getByLabel('Filter by priority').selectOption('low');
  await expect(page.getByRole('heading', { name: 'Old paperwork', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buy groceries', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Team meeting', exact: true })).toHaveCount(0);
  await page.getByLabel('Filter by priority').selectOption('high');
  await expect(page.getByRole('heading', { name: 'Team meeting', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Buy groceries', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Old paperwork', exact: true })).toHaveCount(0);
  await page.getByLabel('Filter by priority').selectOption('all');
  await expect(page.getByRole('heading', { name: 'Old paperwork', exact: true })).toBeVisible();
});

test('priority badges remain visible in dark mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const badge = page.getByTestId('task-row').filter({ hasText: 'Team meeting' }).locator('.priority.high');
  await expect(badge).toBeVisible();
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
