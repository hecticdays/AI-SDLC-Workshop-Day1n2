import { test, expect } from './helpers';
import type { Holiday } from '../lib/db';

function singaporeMonth(): { key: string; label: string } {
  const now = new Date();
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit' }).format(now);
  const label = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', month: 'long', year: 'numeric' }).format(now);
  return { key, label };
}

test('holidays API returns seeded Singapore holidays for the visible month and validates input', async ({ request, playwright }) => {
  const response = await request.get('/api/holidays?year=2027&month=1');
  expect(response.status()).toBe(200);
  const { holidays } = await response.json() as { holidays: Holiday[] };
  expect(holidays.some((holiday) => holiday.date === '2027-01-01' && /New Year/i.test(holiday.name))).toBe(true);
  expect(holidays.every((holiday) => holiday.date >= '2026-12-27' && holiday.date < '2027-02-07')).toBe(true);

  expect((await request.get('/api/holidays?year=2027')).status()).toBe(400);
  expect((await request.get('/api/holidays?year=2027&month=13')).status()).toBe(400);
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3107' });
  try {
    expect((await anonymous.get('/api/holidays')).status()).toBe(401);
  } finally { await anonymous.dispose(); }
});

test('calendar loads the current Singapore month with Sun-Sat headers and today highlighted', async ({ page }) => {
  const current = singaporeMonth();
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: current.label })).toBeVisible();
  const headers = await page.getByRole('columnheader').allTextContents();
  expect(headers).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  await expect(page.getByRole('gridcell')).toHaveCount(42);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  await expect(page.getByRole('gridcell', { name: new RegExp(`^${today}`) })).toHaveClass(/is-today/);
});

test('month navigation updates the heading and ?month= URL, and Today returns to the current month', async ({ page }) => {
  await page.goto('/calendar?month=2030-01');
  await expect(page.getByRole('heading', { name: 'January 2030' })).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('heading', { name: 'February 2030' })).toBeVisible();
  await expect(page).toHaveURL(/month=2030-02/);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('heading', { name: 'December 2029' })).toBeVisible();
  await expect(page).toHaveURL(/month=2029-12/);

  const current = singaporeMonth();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: current.label })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`month=${current.key}`));

  await page.goto('/calendar?month=invalid');
  await expect(page.getByRole('heading', { name: current.label })).toBeVisible();
});

test('todos appear on their Singapore due date with a count badge and open in a day modal', async ({ page }) => {
  // The seeded "Team meeting" is due 2030-01-02T18:00Z, which is 3 January 02:00 in Singapore.
  await page.goto('/calendar?month=2030-01');
  const dueCell = page.getByRole('gridcell', { name: /^2030-01-03.*1 tasks$/ });
  await expect(dueCell).toBeVisible();
  await expect(dueCell.getByText('Team meeting')).toBeVisible();
  await expect(dueCell.locator('.calendar-count')).toHaveText('1');
  await expect(page.getByRole('gridcell', { name: /^2030-01-02.*0 tasks$/ })).toBeVisible();

  await dueCell.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /3 January 2030/ })).toBeVisible();
  await expect(dialog.getByText('Team meeting')).toBeVisible();
  await page.getByRole('button', { name: 'Close day details' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('gridcell', { name: /^2030-01-04/ }).click();
  await expect(page.getByRole('dialog').getByText('No tasks due on this day.')).toBeVisible();
});

test('holidays and weekends are shown on the calendar', async ({ page }) => {
  await page.goto('/calendar?month=2027-01');
  const newYear = page.getByRole('gridcell', { name: /^2027-01-01, .*New Year/i });
  await expect(newYear).toBeVisible();
  await expect(newYear.locator('.holiday-name')).toContainText(/New Year/i);
  // 2 January 2027 is a Saturday and 4 January 2027 is a Monday.
  await expect(page.getByRole('gridcell', { name: /^2027-01-02/ })).toHaveClass(/is-weekend/);
  await expect(page.getByRole('gridcell', { name: /^2027-01-04/ })).not.toHaveClass(/is-weekend/);
});

test('calendar redirects unauthenticated visitors to login', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3107' });
  try {
    const page = await context.newPage();
    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/login$/);
  } finally { await context.close(); }
});
