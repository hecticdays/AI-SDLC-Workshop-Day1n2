import { test, expect } from './helpers';
import Database from 'better-sqlite3';
import { createStore } from '../lib/db';

test('search waits 300ms, resets on typing, and clear bypasses the timer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('task-row')).toHaveCount(4);
  await page.clock.install({ time: new Date('2026-10-30T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-30T00:00:01Z'));
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('groceries');
  await page.clock.runFor(150);
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('meeting');
  await page.clock.runFor(299);
  expect(await page.getByTestId('task-row').count()).toBe(4);
  await page.clock.runFor(1);
  await page.clock.runFor(16);
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  expect(await page.getByTestId('task-row').count()).toBe(4);
});

test('debounced title/subtask search and immediate clearing update section counts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('task-row')).toHaveCount(4);
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('MEETING');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Team meeting' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Completed', exact: true })).toHaveCount(0);
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('presentation');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Team meeting' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(4);
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('unmatched');
  await expect(page.getByRole('heading', { name: 'No todos match your filters' })).toBeVisible();
});

test('all filters combine with AND using inclusive Singapore dates and clear together', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Search todos and subtasks', { exact: true }).fill('meeting');
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
  await page.getByLabel('Completion status').selectOption('incomplete');
  await page.getByLabel('Due date from').fill('2030-01-03');
  await page.getByLabel('Due date to').fill('2030-01-03');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByRole('status', { name: 'Active filters' })).toContainText('Tag: Work');
  await page.getByRole('button', { name: 'Clear tag filter' }).click();
  await expect(page.getByLabel('Filter by tag')).toHaveValue('all');
  await expect(page.getByLabel('Filter by priority')).toHaveValue('high');
  await expect(page.getByLabel('Search todos and subtasks', { exact: true })).toHaveValue('meeting');
  await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
  await page.getByLabel('Due date to').fill('2030-01-02');
  await expect(page.getByText('From date is after To date.')).toBeVisible();
  await expect(page.getByTestId('task-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear All', exact: true }).first().click();
  await expect(page.getByTestId('task-row')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Save Filter', exact: true })).toHaveCount(0);
  await page.getByLabel('Completion status').selectOption('completed');
  await expect(page.getByRole('heading', { name: 'Send report' })).toBeVisible();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});

test('saved presets persist, replace filters, and can be deleted', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByRole('button', { name: 'Save Filter', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save filter', exact: true });
  await expect(dialog).toContainText('Priority: high');
  await dialog.getByLabel('View name').fill('Morning focus');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Morning focus', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Completion status').selectOption('completed');
  await page.getByRole('button', { name: 'Morning focus', exact: true }).click();
  await expect(page.getByLabel('Completion status')).toHaveValue('all');
  await expect(page.getByLabel('Filter by priority')).toHaveValue('high');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete preset Morning focus' }).click();
  await page.getByRole('dialog', { name: 'Delete saved view?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Morning focus', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Morning focus', exact: true })).toHaveCount(0);
});

test('corrupt presets do not crash and long tags fit desktop and mobile', async ({ page, request, account }, testInfo) => {
  await request.post('/api/tags', { data: { name: 'An exceptionally long label that should never break the task layout', color: '#FFFFFF' } });
  await page.goto('/');
  await page.evaluate((userId) => localStorage.setItem(`todo-app:filter-presets:${userId}`, '[{}]'), account.userId);
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(page.getByText('No saved views', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('workspace-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('workspace-dark.png'), fullPage: true });
});

test('deleted tags reset active filters and saved presets fall back without losing other criteria', async ({ page, request }) => {
  await page.goto('/');
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByLabel('Filter by tag').selectOption({ label: 'Work' });
  const tagId = await page.getByLabel('Filter by tag').inputValue();
  await page.getByRole('button', { name: 'Save Filter', exact: true }).click();
  await page.getByRole('dialog').getByLabel('View name').fill('Tagged view');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  expect((await request.delete(`/api/tags/${tagId}`)).status()).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Filter by tag')).toHaveValue('all');
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.getByRole('button', { name: 'Tagged view', exact: true }).click();
  await expect(page.getByLabel('Filter by tag')).toHaveValue('all');
  await expect(page.getByLabel('Filter by priority')).toHaveValue('high');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
});

test('storage quota failures keep the preset dialog retryable and leave tasks intact', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByRole('button', { name: 'Save Filter', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save filter', exact: true });
  await dialog.getByLabel('View name').fill('Unsaved view');
  await page.evaluate(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true, value() { throw new DOMException('Storage full', 'QuotaExceededError'); },
    });
  });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('storage is full or unavailable');
  await expect(dialog.getByLabel('View name')).toHaveValue('Unsaved view');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Unsaved view', exact: true })).toHaveCount(0);
});

test('empty accounts have a different empty state from filtered-out tasks', async ({ page, account }) => {
  const database = new Database(process.env.PERSON4_TEST_DATABASE!);
  try {
    database.pragma('foreign_keys = ON');
    database.prepare('DELETE FROM todos WHERE user_id = ?').run(account.userId);
  } finally { database.close(); }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You have no todos yet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No todos match your filters' })).toHaveCount(0);
  await expect(page.getByTestId('task-row')).toHaveCount(0);
});

test('subtask edits and template-created checklist changes refresh search through the shared event', async ({ page, account }) => {
  await page.goto('/');
  const search = page.getByLabel('Search todos and subtasks', { exact: true });
  await search.fill('presentation');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  const database = new Database(process.env.PERSON4_TEST_DATABASE!);
  try {
    const store = createStore(database);
    database.prepare('UPDATE subtasks SET title = ? WHERE todo_id IN (SELECT id FROM todos WHERE user_id = ?)')
      .run('Updated outline', account.userId);
    await page.evaluate(() => window.dispatchEvent(new Event('todo-app:todos-changed')));
    await expect(page.getByTestId('task-row')).toHaveCount(0);
    await search.fill('updated outline');
    await expect(page.getByRole('heading', { name: 'Team meeting' })).toBeVisible();
    const todo = store.todos.create(account.userId, { title: 'Created from template' });
    const subtask = database.prepare('INSERT INTO subtasks(todo_id, title) VALUES (?, ?)').run(todo.id, 'Unique template checklist');
    await page.evaluate(() => window.dispatchEvent(new Event('todo-app:todos-changed')));
    await search.fill('unique template checklist');
    await expect(page.getByRole('heading', { name: 'Created from template' })).toBeVisible();
    database.prepare('DELETE FROM subtasks WHERE id = ?').run(subtask.lastInsertRowid);
    await page.evaluate(() => window.dispatchEvent(new Event('todo-app:todos-changed')));
    await expect(page.getByTestId('task-row')).toHaveCount(0);
  } finally { database.close(); }
});