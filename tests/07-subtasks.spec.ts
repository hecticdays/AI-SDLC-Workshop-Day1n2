import { test, expect, createTodo } from './helpers';

test('API checklist mutations enforce ownership, strict JSON and cascading deletion', async ({ request, account }) => {
  const todo = await createTodo(request, 'Checklist API');
  const endpoint = `/api/todos/${todo.id}/subtasks`;
  for (const data of [{ title: ' ' }, { title: 'Valid', completed: true }, { title: 2 }]) {
    expect((await request.post(endpoint, { data })).status()).toBe(400);
  }
  expect((await request.post(endpoint, { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  expect((await request.post(`/api/todos/${account.foreignTodo}/subtasks`, { data: { title: 'Private' } })).status()).toBe(404);
  const firstResponse = await request.post(endpoint, { data: { title: 'First' } });
  expect(firstResponse.status()).toBe(201);
  const first = await firstResponse.json();
  const second = await (await request.post(endpoint, { data: { title: 'Second' } })).json();
  expect(second.position).toBe(first.position + 1);
  expect((await request.put(`/api/subtasks/${first.id}`, { data: { completed: 'true' } })).status()).toBe(400);
  expect((await request.put(`/api/subtasks/${first.id}`, { data: { title: 'Renamed', completed: true } })).status()).toBe(200);
  await request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
  const saved = await (await request.get(`/api/todos/${todo.id}`)).json();
  expect(saved.subtasks[1].completed).toBe(false);
  expect((await request.delete(`/api/todos/${todo.id}`)).ok()).toBe(true);
  expect((await request.put(`/api/subtasks/${first.id}`, { data: { completed: false } })).status()).toBe(404);
  expect((await request.delete(`/api/subtasks/${second.id}`)).status()).toBe(404);
});

test('checklist add, rename, toggle, collapse, remove and parent completion stay independent', async ({ page, request }) => {
  await createTodo(request, 'Checklist journey');
  await page.goto('/');
  const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Checklist journey', exact: true }) });
  await expect(row.getByRole('progressbar')).toHaveCount(0);
  await row.getByText('Subtasks', { exact: true }).click();
  const input = row.getByRole('textbox', { name: 'New subtask' });
  await input.fill('First step');
  await input.press('Enter');
  await expect(row.getByText('0/1 subtasks')).toBeVisible();
  await input.fill('Second step');
  await row.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await row.getByRole('checkbox', { name: 'Complete subtask First step' }).check();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await row.getByRole('button', { name: 'Rename subtask First step' }).click();
  await row.getByRole('textbox', { name: 'Subtask title' }).fill('Renamed step');
  await row.getByRole('textbox', { name: 'Subtask title' }).press('Enter');
  await expect(row.getByRole('checkbox', { name: 'Complete subtask Renamed step' })).toBeChecked();
  await row.getByRole('checkbox', { name: 'Complete subtask Second step' }).check();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(row.getByRole('button', { name: 'Complete task Checklist journey', exact: true })).toBeVisible();
  await row.getByText('Subtasks', { exact: true }).click();
  await expect(row.getByText('2/2 subtasks')).toBeVisible();
  await row.getByText('Subtasks', { exact: true }).click();
  await row.getByRole('button', { name: 'Delete subtask Second step' }).click();
  await expect(row.getByText('1/1 subtasks')).toBeVisible();
  await row.getByRole('button', { name: 'Delete subtask Renamed step' }).click();
  await expect(row.getByRole('progressbar')).toHaveCount(0);
  await input.fill(' ');
  await expect(row.getByRole('button', { name: 'Add subtask', exact: true })).toBeDisabled();
  await row.getByRole('button', { name: 'Complete task Checklist journey', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Reopen task Checklist journey', exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Delete task Checklist journey', exact: true }).click();
  await expect(row).toHaveCount(0);
});

test('failed checklist save keeps the draft and allows retry', async ({ page, request }) => {
  await createTodo(request, 'Checklist recovery');
  await page.goto('/');
  const row = page.getByTestId('task-row').filter({ hasText: 'Checklist recovery' });
  await row.getByText('Subtasks', { exact: true }).click();
  await page.route('**/api/todos/*/subtasks', (route) => route.fulfill({ status: 500, json: { error: 'Please retry checklist save' } }), { times: 1 });
  await row.getByRole('textbox', { name: 'New subtask' }).fill('Retained draft');
  await row.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Please retry' })).toContainText('Please retry');
  await expect(row.getByRole('textbox', { name: 'New subtask' })).toHaveValue('Retained draft');
  await row.getByRole('button', { name: 'Add subtask', exact: true }).click();
  await expect(row.getByRole('checkbox', { name: 'Complete subtask Retained draft' })).toBeVisible();
});