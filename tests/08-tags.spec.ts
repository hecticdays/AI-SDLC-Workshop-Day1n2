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
  const tag = await createTag(request, 'API tag', '#123456');
  const todo = await createTodo(request, 'API todo');
  const renamed = await request.put(`/api/tags/${tag.id}`, { data: { name: 'Renamed' } });
  expect(renamed.status()).toBe(200);
  expect((await renamed.json()).color).toBe('#123456');
  const recolored = await request.put(`/api/tags/${tag.id}`, { data: { color: '#ABCDEF' } });
  expect(recolored.status()).toBe(200);
  expect((await recolored.json()).name).toBe('Renamed');
  expect((await request.put(`/api/tags/${tag.id}`, { data: {} })).status()).toBe(400);
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

test('failed tag assignments roll back, retain focus, and can be retried', async ({ page }) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Edit tags for Team meeting' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Task tags' });
  const checkbox = dialog.getByLabel('Work', { exact: true });
  await page.route('**/api/todos/*/tags', (route) => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Tag change failed. Please retry.' }),
  }));
  await checkbox.uncheck();
  await expect(dialog.getByRole('alert')).toContainText('Tag change failed');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.unroute('**/api/todos/*/tags');
  await trigger.click();
  await checkbox.uncheck();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  const meeting = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Team meeting' }) });
  await expect(meeting).toBeVisible();
  await expect(meeting.getByRole('button', { name: 'Work', exact: true })).toHaveCount(0);
});

test('custom tag colors keep AA text contrast and long labels fit in both themes', async ({ page, request }, testInfo) => {
  const colors = ['#FFFFFF', '#000000', '#FFFF00', '#777777', '#3B82F6'];
  const tags = [];
  for (const [index, color] of colors.entries()) {
    tags.push(await createTag(request, index === 0 ? 'An exceptionally long assigned label that should never break the task layout' : `Contrast ${index}`, color));
  }
  await createTodo(request, 'Contrast task', tags.map((tag) => tag.id));
  await page.goto('/');
  const row = page.getByTestId('task-row').filter({ has: page.getByRole('heading', { name: 'Contrast task' }) });
  await expect(row).toBeVisible();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
    for (const tag of tags) {
      const ratio = await row.getByRole('button', { name: tag.name, exact: true }).evaluate((element) => {
        const style = getComputedStyle(element);
        const luminance = (color: string) => {
          const channels = color.match(/\d+/g)!.slice(0, 3).map(Number)
            .map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`tag-contrast-${theme}.png`), fullPage: true });
  }
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

test('warm tag CRUD requests average under 300ms', async ({ request }) => {
  const warmup = await createTag(request, 'Latency warmup');
  expect((await request.put(`/api/tags/${warmup.id}`, { data: { name: 'Warmed' } })).status()).toBe(200);
  expect((await request.delete(`/api/tags/${warmup.id}`)).status()).toBe(204);
  await request.get('/api/tags');
  const started = performance.now();
  const iterations = 5;
  for (let index = 0; index < iterations; index++) {
    const tag = await createTag(request, `Latency ${index}`);
    expect((await request.get('/api/tags')).status()).toBe(200);
    expect((await request.put(`/api/tags/${tag.id}`, { data: { color: '#000000' } })).status()).toBe(200);
    expect((await request.delete(`/api/tags/${tag.id}`)).status()).toBe(204);
  }
  expect((performance.now() - started) / (iterations * 4)).toBeLessThan(300);
});