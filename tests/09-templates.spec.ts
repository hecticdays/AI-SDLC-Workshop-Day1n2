import { test, expect } from './helpers';

test('API templates validate, isolate accounts and instantiate fresh snapshots', async ({ request, account }) => {
  const before = Date.now();
  const response = await request.post('/api/templates', { data: { name: 'API template', title_template: 'Snapshot',
    is_recurring: true, recurrence_pattern: 'weekly', reminder_minutes: 15, due_date_offset_minutes: 1,
    subtasks: [{ title: 'One', position: 0 }, { title: 'Two', position: 1 }] } });
  expect(response.status()).toBe(201);
  const template = await response.json();
  for (const data of [{ due_date_offset_minutes: 0 }, { due_date_offset_minutes: 1.5 }, { tag_ids: [account.foreignTag] }, { reminder_minutes: 15 }]) {
    expect((await request.post('/api/templates', { data: { name: 'Invalid', title_template: 'Invalid', ...data } })).status()).toBe(400);
  }
  expect((await request.put(`/api/templates/${template.id}`, { data: { due_date_offset_minutes: null } })).status()).toBe(400);
  expect((await request.post('/api/templates', { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  const usedResponse = await request.post(`/api/templates/${template.id}/use`);
  expect(usedResponse.status()).toBe(201);
  const used = await usedResponse.json();
  expect(used.tags).toEqual([]);
  expect(used.subtasks.map((child: { completed: boolean }) => child.completed)).toEqual([false, false]);
  expect(Date.parse(used.due_date)).toBeGreaterThanOrEqual(before + 60_000);
  await request.delete(`/api/templates/${template.id}`);
  expect((await request.post(`/api/templates/${template.id}/use`)).status()).toBe(404);
  expect((await request.get(`/api/todos/${used.id}`)).ok()).toBe(true);
});

test('draft checklist saves as template, quick use, category edit and confirmed delete preserve snapshots', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New task title', exact: true }).fill('Weekly preparation');
  await page.getByRole('combobox', { name: 'New task priority', exact: true }).selectOption('high');
  await page.getByRole('spinbutton', { name: 'Due in minutes', exact: true }).fill('60');
  await page.getByRole('combobox', { name: 'New task recurrence', exact: true }).selectOption('weekly');
  await page.getByRole('combobox', { name: 'New task reminder', exact: true }).selectOption('15');
  await page.getByRole('textbox', { name: 'Draft subtask', exact: true }).fill('Agenda');
  await page.getByRole('button', { name: 'Add draft subtask', exact: true }).click();
  await page.getByRole('textbox', { name: 'Draft subtask', exact: true }).fill('Materials');
  await page.getByRole('button', { name: 'Add draft subtask', exact: true }).click();
  await page.getByRole('button', { name: 'Save as template', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Save template', exact: true });
  await dialog.getByRole('textbox', { name: 'Template name', exact: true }).fill('Weekly kit');
  await dialog.getByRole('combobox', { name: 'Category', exact: true }).fill('Work');
  await dialog.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Use template', exact: true }).selectOption({ label: 'Weekly kit (Work)' });
  const row = page.getByTestId('task-row').filter({ hasText: 'Weekly preparation' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('0/2 subtasks');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Templates', exact: true });
  await dialog.getByRole('combobox', { name: 'Template category', exact: true }).selectOption('Work');
  await dialog.getByRole('button', { name: 'Edit template Weekly kit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit template', exact: true });
  await editor.getByRole('textbox', { name: 'Template name', exact: true }).fill('Updated kit');
  await editor.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(dialog.getByText('Updated kit', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Use template Updated kit', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(2);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete template Updated kit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete template?', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByText('Updated kit', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete template Updated kit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete template?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByText('Updated kit', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(row).toHaveCount(2);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((body) => body.clientWidth));
});