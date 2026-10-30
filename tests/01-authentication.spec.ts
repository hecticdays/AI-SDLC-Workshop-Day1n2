import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { SignJWT } from 'jose';
import { resolve } from 'node:path';

async function authenticator(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { client, authenticatorId };
}

async function submit(page: Page, username: string, action: 'Register' | 'Login') {
  await page.getByRole('tab', { name: action === 'Register' ? 'Create account' : 'Sign in', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByRole('button', { name: action === 'Register' ? 'Create passkey' : 'Continue with passkey', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function logout(page: Page) {
  const response = await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then(result => result.status));
  expect(response).toBe(200);
  await page.goto('/login');
}

test('passkeys register, log in, enroll, isolate two accounts, and reject replay', async ({ page, context, baseURL }) => {
  const { client, authenticatorId } = await authenticator(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  const alice = `alice-${randomUUID()}`;
  const bob = `bob-${randomUUID()}`;
  await submit(page, alice, 'Register');
  const aliceSession = await (await context.request.get('/api/auth/me')).json();
  expect(aliceSession.username).toBe(alice);
  expect(await page.locator('.app-header').evaluate((header) => {
    const frame = header.getBoundingClientRect();
    return Array.from(header.querySelectorAll('button')).every((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.top >= frame.top && bounds.bottom <= frame.bottom && bounds.left >= 0 && bounds.right <= innerWidth;
    });
  })).toBe(true);
  let additionalAuthenticator = '';
  await page.route('**/api/auth/enroll-options', async route => {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    const added = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    additionalAuthenticator = added.authenticatorId;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Add passkey', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Passkey added');
  await page.unroute('**/api/auth/enroll-options');
  const credentials = await client.send('WebAuthn.getCredentials', { authenticatorId: additionalAuthenticator });
  expect(credentials.credentials).toHaveLength(1);
  await logout(page);
  const loginRequest = page.waitForRequest(request => request.url().endsWith('/api/auth/login-verify'));
  await submit(page, alice, 'Login');
  const captured = (await loginRequest).postDataJSON();
  const replay = await context.request.post('/api/auth/login-verify', { data: captured, headers: { origin: baseURL! } });
  expect(replay.status()).toBe(401);
  await logout(page);
  await submit(page, bob, 'Register');
  const bobSession = await (await context.request.get('/api/auth/me')).json();
  expect(bobSession.userId).not.toBe(aliceSession.userId);
  expect(bobSession.username).toBe(bob);
  const crossAccount = await context.request.post('/api/auth/login-verify', {
    data: { ...captured, username: bob }, headers: { origin: baseURL! },
  });
  expect(crossAccount.status()).toBe(401);
  const forbiddenOrigin = await context.request.post('/api/auth/logout', { headers: { origin: 'https://attacker.invalid' } });
  expect(forbiddenOrigin.status()).toBe(400);
  expect((await context.request.get('/api/auth/me')).status()).toBe(200);
  await logout(page);
  await submit(page, alice, 'Login');
  expect((await (await context.request.get('/api/auth/me')).json()).userId).toBe(aliceSession.userId);
  await client.detach();
});

test('invalid input, duplicate usernames, cross-browser attempts, forged sessions, and API authorization', async ({ page, context, browser, baseURL }) => {
  const { client } = await authenticator(page);
  await page.goto('/login');
  const username = `negative-${randomUUID()}`;
  await submit(page, username, 'Register');
  const headers = { origin: baseURL! };
  expect((await context.request.post('/api/auth/register-options', { headers, data: { username } })).status()).toBe(409);
  expect((await context.request.post('/api/auth/register-options', { headers, data: { username: '' } })).status()).toBe(400);
  await logout(page);
  const options = await context.request.post('/api/auth/login-options', { headers, data: { username } });
  expect(options.status()).toBe(200);
  expect((await options.json()).userVerification).toBe('required');
  const other = await browser.newContext({ baseURL });
  const crossBrowser = await other.request.post('/api/auth/login-verify', {
    headers, data: { username, response: { id: 'forged' } },
  });
  expect(crossBrowser.status()).toBe(401);
  expect((await other.request.post('/api/auth/enroll-options', { headers, data: {} })).status()).toBe(401);
  await other.addCookies([{ name: 'session', value: 'forged.jwt.token', url: baseURL! }]);
  expect((await other.request.get('/api/auth/me')).status()).toBe(401);
  expect((await other.request.get('/api/todos')).status()).toBe(401);
  const protectedPage = await other.newPage();
  await protectedPage.goto('/calendar');
  await expect(protectedPage).toHaveURL(/\/login$/);
  await other.close();
  await client.detach();
});

test('anonymous endpoints enforce origins, random attempt cookies, expiry, and one-shot failures', async ({ request, playwright, baseURL }) => {
  const headers = { origin: baseURL! };
  const username = `attempt-${randomUUID()}`;
  expect((await request.post('/api/auth/register-options', { data: { username } })).status()).toBe(400);
  expect((await request.post('/api/auth/register-options', { headers: { origin: 'https://evil.invalid' }, data: { username } })).status()).toBe(400);
  expect((await request.post('/api/auth/register-options', { headers: { ...headers, 'sec-fetch-site': 'cross-site' }, data: { username } })).status()).toBe(400);
  const options = await request.post('/api/auth/register-options', { headers, data: { username } });
  expect(options.status()).toBe(200);
  const body = await options.json();
  expect(body.authenticatorSelection.userVerification).toBe('required');
  expect(body.user.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const state = await request.storageState();
  const attempt = state.cookies.find(cookie => cookie.name === 'auth_attempt_register')!;
  expect(attempt.httpOnly).toBe(true);
  expect(attempt.sameSite).toBe('Strict');
  const browserCookie = state.cookies.find(cookie => cookie.name === 'auth_browser')!;
  expect(attempt.value).not.toBe(browserCookie.value);
  const other = await playwright.request.newContext({ baseURL, storageState: { cookies: [attempt], origins: [] } });
  expect((await other.post('/api/auth/register-verify', { headers, data: { username, response: { id: 'forged' } } })).status()).toBe(401);
  await other.dispose();
  const database = new Database(process.env.PERSON4_TEST_DATABASE!);
  database.prepare('UPDATE auth_attempts SET expires = 1 WHERE username = ?').run(username);
  const verification = { headers, data: { username, response: { id: 'forged' } } };
  expect((await request.post('/api/auth/register-verify', verification)).status()).toBe(401);
  expect((await request.post('/api/auth/register-verify', verification)).status()).toBe(401);
  expect((await request.post('/api/auth/register-options', { headers, data: { username } })).status()).toBe(200);
  expect((await request.post('/api/auth/register-verify', verification)).status()).toBe(401);
  expect((database.prepare('SELECT count(*) AS total FROM auth_attempts WHERE username = ?').get(username) as { total: number }).total).toBe(0);
  database.close();
});

test('enrollment requires recent authentication even with a valid old session', async ({ request, baseURL }) => {
  const database = new Database(process.env.PERSON4_TEST_DATABASE!);
  const username = `stale-${randomUUID()}`;
  const id = Number(database.prepare('INSERT INTO users(username) VALUES (?)').run(username).lastInsertRowid);
  const token = await new SignJWT({ userId: id, username, authTime: Math.floor(Date.now() / 1000) - 600 })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET ?? 'person4-test-only-secret-not-for-deployment-0000'));
  const headers = { origin: baseURL!, cookie: `session=${token}` };
  expect((await request.get('/api/auth/me', { headers })).status()).toBe(200);
  expect((await request.post('/api/auth/enroll-options', { headers, data: {} })).status()).toBe(401);
  expect((await request.post('/api/auth/enroll-verify', { headers, data: { response: {} } })).status()).toBe(401);
  database.prepare('DELETE FROM users WHERE id = ?').run(id);
  database.close();
});

test('real signed ceremonies work independently of the task-page build', async ({ page, context, baseURL }) => {
  const { client, authenticatorId } = await authenticator(page);
  await page.goto('/login');
  await expect(page.locator('#auth-title')).toBeVisible();
  await page.addScriptTag({ path: resolve('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js') });
  async function ceremony(operation: 'register' | 'login' | 'enroll', username?: string, credentialId?: string) {
    return page.evaluate(async ({ operation, username, credentialId }) => {
      const library = (window as unknown as { SimpleWebAuthnBrowser: typeof import('@simplewebauthn/browser') }).SimpleWebAuthnBrowser;
      const post = async (path: string, data: unknown) => {
        const result = await fetch(`/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        return { status: result.status, body: await result.json() };
      };
      const options = await post(`${operation}-options`, { username });
      if (options.status !== 200) throw new Error(JSON.stringify(options));
      const response = operation === 'login'
        ? await library.startAuthentication({ optionsJSON: { ...options.body,
          ...(credentialId ? { allowCredentials: [{ id: credentialId, type: 'public-key' }] } : {}) } })
        : await library.startRegistration({ optionsJSON: options.body });
      return { result: await post(`${operation}-verify`, { username, response }), response, options: options.body };
    }, { operation, username, credentialId });
  }
  const alice = `isolated-alice-${randomUUID()}`;
  const bob = `isolated-bob-${randomUUID()}`;
  const registration = await ceremony('register', alice);
  expect(registration.result.status).toBe(200);
  const aliceSession = await (await context.request.get('/api/auth/me')).json();
  expect(aliceSession.username).toBe(alice);
  const headers = { origin: baseURL! };
  expect((await context.request.post('/api/auth/logout', { headers })).status()).toBe(200);
  expect((await context.request.get('/api/auth/me')).status()).toBe(401);
  expect((await ceremony('login', alice)).result.status).toBe(200);
  await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
  const second = await authenticator(page);
  const enrollment = await ceremony('enroll');
  expect(enrollment.result.status).toBe(200);
  expect(enrollment.options.user.id).toBe(registration.options.user.id);
  await context.request.post('/api/auth/logout', { headers });
  const login = await ceremony('login', alice);
  expect(login.result.status).toBe(200);
  expect((await context.request.post('/api/auth/login-verify', { headers, data: { username: alice, response: login.response } })).status()).toBe(401);
  await context.request.post('/api/auth/logout', { headers });
  expect((await ceremony('register', bob)).result.status).toBe(200);
  const bobSession = await (await context.request.get('/api/auth/me')).json();
  expect(bobSession.userId).not.toBe(aliceSession.userId);
  const crossAccount = await ceremony('login', bob, enrollment.response.id);
  expect(crossAccount.result.status).toBe(401);
  expect((await (await context.request.get('/api/auth/me')).json()).userId).toBe(bobSession.userId);
  await second.client.detach();
  await client.detach();
});