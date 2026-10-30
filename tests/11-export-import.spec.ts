import { test, expect, createTodo } from './helpers';

test('JSON and CSV download with Singapore-dated filenames', async ({ page }) => {
  await page.goto('/');
  for (const format of ['JSON', 'CSV']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(new RegExp(`^todos-\\d{4}-\\d{2}-\\d{2}\\.${format.toLowerCase()}$`));
    expect(await download.failure()).toBeNull();
  }
});

test('round-trip import restores checklist and tags and repeated imports create new copies', async ({ page, request }) => {
  const original = await createTodo(request, 'Portable task');
  await request.post(`/api/todos/${original.id}/subtasks`, { data: { title: 'Portable checklist' } });
  const exported = await request.get('/api/todos/export');
  expect(exported.status()).toBe(200);
  const backup = await exported.json();
  await request.delete(`/api/todos/${original.id}`);
  await page.goto('/');
  for (let iteration = 1; iteration <= 2; iteration++) {
    await page.getByLabel('Import JSON file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.getByRole('status').filter({ hasText: `Successfully imported ${backup.todos.length} todos` })).toBeVisible();
    await expect(page.getByTestId('task-row').filter({ hasText: 'Portable task' })).toHaveCount(iteration);
  }
  const result = await (await request.get('/api/todos')).json();
  const copies = result.filter((todo: { title: string }) => todo.title === 'Portable task');
  expect(copies).toHaveLength(2);
  expect(copies[0].subtasks[0].title).toBe('Portable checklist');
  expect(copies[0].id).not.toBe(copies[1].id);
  expect(result.some((todo: { title: string; tags: unknown[] }) => todo.title === 'Team meeting' && todo.tags.length > 0)).toBe(true);
});

test('invalid file errors are retryable with the same file name', async ({ page }) => {
  await page.goto('/');
  for (const [contents, message] of [['not JSON', 'Invalid JSON format'], ['{}', 'Failed to import todos. Please check the file format.']]) {
    await page.getByLabel('Import JSON file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
    await expect(page.getByRole('alert').filter({ hasText: message })).toHaveText(message);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  }
});

test('API rejects invalid formats, malformed payloads and cross-origin imports without writes', async ({ request }) => {
  expect((await request.get('/api/todos/export?format=xml')).status()).toBe(400);
  const before = await (await request.get('/api/todos')).json();
  const invalid = await request.post('/api/todos/import', { data: Buffer.from('{'), headers: { 'Content-Type': 'application/json' } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toBe('Invalid JSON format');
  expect((await request.post('/api/todos/import', { data: {}, headers: { origin: 'https://untrusted.example' } })).status()).toBe(403);
  expect(await (await request.get('/api/todos')).json()).toEqual(before);
});

test('export and import require a session and exclude foreign-owned records', async ({ browser, request }) => {
  const context = await browser.newContext();
  try {
    expect((await context.request.get('/api/todos/export')).status()).toBe(401);
    expect((await context.request.post('/api/todos/import', { data: {} })).status()).toBe(401);
    const backup = await (await request.get('/api/todos/export')).json();
    expect(backup.todos.some((todo: { title: string }) => todo.title === 'Confidential')).toBe(false);
    expect(backup.todos.every((todo: Record<string, unknown>) => !('user_id' in todo))).toBe(true);
  } finally { await context.close(); }
});