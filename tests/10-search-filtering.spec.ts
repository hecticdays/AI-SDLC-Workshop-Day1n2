import { test, expect } from './helpers';

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