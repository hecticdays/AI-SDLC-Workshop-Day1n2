import { test, expect, createTag, createTodo } from './helpers';

test('create, edit, assign, filter and delete tags through the UI', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('button', { name: 'Manage tags', exact: true }).click();
  const manager = page.getByRole('dialog', { name: 'Manage tags' });
  await manager.getByLabel('Tag name', { exact: true }).fill('Planning');
  await manager.getByLabel('Tag hex color').fill('#FFFFFF');
  await manager.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(manager.getByText('Planning', { exact: true })).toBeVisible();
  await manager.getByLabel('Tag name', { exact: true }).fill(' planning ');
  await manager.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect(manager.getByRole('alert')).toContainText('already exists');
  await manager.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Edit tags for Team meeting' }).click();
  const assignments = page.getByRole('dialog', { name: 'Task tags' });
  await assignments.getByLabel('Planning', { exact: true }).check();
  await expect(assignments.getByLabel('Planning', { exact: true })).toBeEnabled();
  await assignments.getByRole('button', { name: 'Done' }).click();
  const meeting = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Team meeting' }) });
  await expect(meeting.getByRole('button', { name: 'Planning', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Manage tags', exact: true }).click();
  await manager.getByRole('button', { name: 'Edit tag Planning', exact: true }).click();
  await manager.getByLabel('Tag name', { exact: true }).fill('Roadmap');
  await manager.getByLabel('Tag hex color').fill('#000000');
  await manager.getByRole('button', { name: 'Update tag' }).click();
  await expect(manager.getByRole('button', { name: 'Edit tag Roadmap', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Close dialog' }).click();
  await meeting.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await page.getByRole('main').getByRole('button', { name: 'Manage tags', exact: true }).click();
  await manager.getByRole('button', { name: 'Delete tag Roadmap', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete tag?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(manager.getByRole('button', { name: 'Delete tag Roadmap', exact: true })).toHaveCount(0);
  await manager.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Filter by tag')).toHaveValue('all');
  await expect(page.getByTestId('task-row')).toHaveCount(4);
});

test('multiple tags can be selected on creation and detached independently', async ({ page, request }) => {
  const first = await createTag(request, 'First');
  const second = await createTag(request, 'Second');
  await page.goto('/');
  await page.getByLabel('New task title').fill('Tagged task');
  await page.locator('.composer').getByRole('button', { name: first.name, exact: true }).click();
  await page.locator('.composer').getByRole('button', { name: second.name, exact: true }).click();
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const row = page.getByTestId('task-row').filter({ hasText: 'Tagged task' });
  await expect(row.getByRole('button', { name: first.name, exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: second.name, exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit tags for Tagged task' }).click();
  await page.getByRole('dialog').getByLabel('First', { exact: true }).uncheck();
  await expect(page.getByRole('dialog').getByLabel('First', { exact: true })).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(row.getByRole('button', { name: 'First', exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Second', exact: true })).toBeVisible();
});

test('API validates input, protects both association owners, and handles duplicate operations', async ({ request, account }) => {
  const tag = await createTag(request, 'API tag');
  const todo = await createTodo(request, 'API todo');
  for (const body of [{ name: 7 }, { name: ' ' }, { name: 'Bad', color: '' }, { name: 'Bad', color: 'red' }]) {
    expect((await request.post('/api/tags', { data: body })).status()).toBe(400);
  }
  expect((await request.post('/api/tags', { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  expect((await request.put(`/api/tags/${account.foreignTag}`, { data: { name: 'Stolen' } })).status()).toBe(404);
  expect((await request.delete(`/api/tags/${account.foreignTag}`)).status()).toBe(404);
  expect((await request.post(`/api/todos/${todo.id}/tags`, { data: { tag_id: account.foreignTag } })).status()).toBe(404);
  expect((await request.post(`/api/todos/${account.foreignTodo}/tags`, { data: { tag_id: tag.id } })).status()).toBe(404);
  expect((await request.delete(`/api/todos/${account.foreignTodo}/tags`, { data: { tag_id: tag.id } })).status()).toBe(404);
  expect((await request.post('/api/tags', { data: { name: 'Cross origin' }, headers: { origin: 'https://other.invalid' } })).status()).toBe(403);
  for (let attempt = 0; attempt < 2; attempt++) expect((await request.post(`/api/todos/${todo.id}/tags`, { data: { tag_id: tag.id } })).status()).toBe(200);
  const rows = await (await request.get('/api/todos')).json();
  expect(rows.find((row: { id: number }) => row.id === todo.id).tags).toHaveLength(1);
  for (let attempt = 0; attempt < 2; attempt++) expect((await request.delete(`/api/todos/${todo.id}/tags`, { data: { tag_id: tag.id } })).status()).toBe(200);
});

test('all tag endpoints reject missing and invalid sessions', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3107' });
  try {
    for (const [method, path] of [['GET', '/api/tags'], ['POST', '/api/tags'], ['PUT', '/api/tags/1'], ['DELETE', '/api/tags/1'], ['POST', '/api/todos/1/tags'], ['DELETE', '/api/todos/1/tags']]) {
      expect((await anonymous.fetch(path, { method, data: {} })).status()).toBe(401);
    }
    expect((await anonymous.get('/api/tags', { headers: { cookie: 'session=invalid' } })).status()).toBe(401);
  } finally { await anonymous.dispose(); }
});