import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';
import { createAuthStore } from '../lib/auth-store';
import { assertTrustedRequest, authConfig, requestAddress } from '../lib/auth-security';
import { signSessionToken, verifySessionToken } from '../lib/auth-token';

test('only trusted, valid forwarded addresses can identify an IP bucket', () => {
  const previous = process.env.AUTH_TRUST_PROXY;
  try {
    delete process.env.AUTH_TRUST_PROXY;
    const request = (address?: string) => new Request('http://localhost:3000', {
      headers: address === undefined ? {} : { 'x-forwarded-for': address },
    });
    assert.equal(requestAddress(request('192.0.2.1')), undefined);
    process.env.AUTH_TRUST_PROXY = 'true';
    for (const address of [undefined, '', 'unknown', 'not-an-ip', '192.0.2.1:1234', '999.1.1.1']) {
      assert.equal(requestAddress(request(address)), undefined);
    }
    assert.equal(requestAddress(request('192.0.2.1, 198.51.100.1')), '192.0.2.1');
    assert.equal(requestAddress(request('2001:db8::1')), '2001:db8::1');
  } finally {
    if (previous === undefined) delete process.env.AUTH_TRUST_PROXY;
    else process.env.AUTH_TRUST_PROXY = previous;
  }
});

test('browser limits are independent without a trusted IP and never block trusted logout', async context => {
  const previous = { ...process.env };
  const headersModule = createRequire(import.meta.url)('next/headers') as typeof import('next/headers');
  const jar = new ResponseCookies(new Headers());
  context.mock.method(headersModule, 'cookies', async () => jar as Awaited<ReturnType<typeof headersModule.cookies>>);
  process.env.DATABASE_PATH = ':memory:';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.WEBAUTHN_RP_ID = 'localhost';
  process.env.JWT_SECRET = 'auth-unit-test-only-secret-minimum-32-bytes';
  delete process.env.AUTH_TRUST_PROXY;
  const { getDatabase } = await import('../lib/db');
  const { authEndpoint } = await import('../lib/webauthn');
  const database = getDatabase();
  try {
    const store = createAuthStore(database);
    const browserA = 'a'.repeat(43);
    const browserB = 'b'.repeat(43);
    for (let count = 0; count < 300; count++) store.limit('ip:unknown', 300);
    for (let count = 0; count < 60; count++) store.limit(`browser:${browserA}`, 60);
    const request = (origin = process.env.APP_ORIGIN!) => new Request(`${origin}/api/auth/register-options`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1' },
      body: JSON.stringify({ username: '' }),
    });
    jar.set('auth_browser', browserB);
    assert.equal((await authEndpoint(request(), 'register')).status, 400);
    jar.set('auth_browser', browserA);
    assert.equal((await authEndpoint(request(), 'register')).status, 429);
    jar.set('auth_browser', browserB);
    assert.equal((await authEndpoint(request(), 'register')).status, 400);
    process.env.AUTH_TRUST_PROXY = 'true';
    for (let count = 0; count < 300; count++) store.limit('ip:192.0.2.1', 300);
    assert.equal((await authEndpoint(request(), 'register')).status, 429);
    jar.set('auth_browser', browserA);
    const user = store.register('session-fixture', 'session-handle', {
      id: 'session-key', publicKey: new Uint8Array([1, 2]), counter: 0,
    });
    const { SignJWT } = await import('jose');
    const { createSession, getSession, getRecentlyAuthenticatedSession } = await import('../lib/auth');
    const legacy = await new SignJWT({ userId: user.id, username: user.username })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    jar.set('session', legacy);
    assert.equal((await getSession())?.userId, user.id);
    assert.equal(await getRecentlyAuthenticatedSession(), null);
    assert.equal((await authEndpoint(request(), 'enroll')).status, 429);
    await createSession(user);
    assert.equal((await getRecentlyAuthenticatedSession())?.userId, user.id);
    jar.set('session', await signSessionToken({ id: 999999, username: 'deleted-account' }));
    assert.equal(await getSession(), null);
    jar.set('session', 'existing-session');
    assert.equal((await authEndpoint(request('https://attacker.invalid'), 'logout')).status, 400);
    assert.equal(jar.get('session')?.value, 'existing-session');
    const response = await authEndpoint(request(), 'logout');
    assert.equal(response.status, 200);
    assert.equal(jar.get('session')?.value, '');
    assert.equal(jar.get('session')?.maxAge, 0);
    for (const name of ['auth_browser', 'auth_attempt_register', 'auth_attempt_login', 'auth_attempt_enroll']) {
      assert.equal(response.cookies.get(name)?.value, '');
      assert.equal(response.cookies.get(name)?.maxAge, 0);
    }
  } finally {
    database.close();
    for (const key of ['DATABASE_PATH', 'APP_ORIGIN', 'WEBAUTHN_RP_ID', 'JWT_SECRET', 'AUTH_TRUST_PROXY']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('challenges are single-use, expiring, and bound to browser/account/operation', () => {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL)');
  const store = createAuthStore(database);
  const attempt = { browser: 'browser-a', username: 'alice', operation: 'login' as const, challenge: 'random-challenge', handle: 'opaque-handle', userId: 1 };
  const attemptId = store.saveAttempt(attempt, 1000);
  assert.equal(store.consumeAttempt(attemptId, { ...attempt, browser: 'browser-b' }, 1001), undefined);
  assert.equal(store.consumeAttempt(attemptId, { ...attempt, username: 'bob' }, 1001), undefined);
  assert.equal(store.consumeAttempt(attemptId, { ...attempt, operation: 'enroll' }, 1001), undefined);
  assert.equal(store.consumeAttempt(attemptId, attempt, 1001)?.challenge, attempt.challenge);
  assert.equal(store.consumeAttempt(attemptId, attempt, 1002), undefined);
  const expired = store.saveAttempt(attempt, 1000);
  assert.equal(store.consumeAttempt(expired, attempt, 301001), undefined);
  database.close();
});

test('origin is pinned and cross-site POST requests are rejected', () => {
  const config = authConfig({ NODE_ENV: 'development' });
  assert.equal(config.origin, 'http://localhost:3000');
  assert.throws(() => authConfig({ NODE_ENV: 'production' }));
  assert.throws(() => assertTrustedRequest(new Request('http://localhost:3000/api/auth/logout', { method: 'POST' }), config));
  assert.throws(() => assertTrustedRequest(new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin: config.origin, 'sec-fetch-site': 'cross-site' },
  }), config));
  assert.doesNotThrow(() => assertTrustedRequest(new Request('http://localhost:3000/api/auth/logout', {
    method: 'POST', headers: { origin: config.origin, 'sec-fetch-site': 'same-origin' },
  }), config));
});

test('registration is atomic, usernames unique, handles stable, and credentials account scoped', () => {
  const database = new Database(':memory:');
  database.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL)');
  const store = createAuthStore(database);
  const credential = { id: 'alice-key', publicKey: new Uint8Array([1, 2]), counter: 0 };
  const alice = store.register('alice', 'opaque-a', credential);
  const bob = store.register('bob', 'opaque-b', { ...credential, id: 'bob-key' });
  assert.equal(store.handle(alice.id), 'opaque-a');
  assert.equal(store.handle(alice.id), store.handle(alice.id));
  assert.throws(() => store.register('alice', 'other', { ...credential, id: 'other-key' }), /taken/);
  assert.throws(() => store.register('rolled-back', 'opaque-c', credential));
  assert.equal(store.findUser('rolled-back'), undefined);
  assert.equal(store.credential('alice-key', bob.id), undefined);
  const existing = store.credential('alice-key', alice.id)!;
  store.updateCounter(existing, 1);
  assert.throws(() => store.updateCounter(existing, 2), /Concurrent/);
  assert.throws(() => store.updateCounter(store.credential('alice-key', alice.id)!, 0), /counter/);
  store.enroll(alice.id, { ...credential, id: 'extra-key' });
  assert.equal(store.credentials(alice.id).length, 2);
  for (let attempt = 0; attempt < 3; attempt++) store.limit('browser', 3, 1000);
  assert.throws(() => store.limit('browser', 3, 1001), /Too many/);
  assert.doesNotThrow(() => store.limit('browser', 3, 61000));
  database.close();
});

test('session tokens reject forgery, expiry, malformed claims, and missing secrets', async () => {
  process.env.JWT_SECRET = 'auth-unit-test-only-secret-minimum-32-bytes';
  const token = await signSessionToken({ id: 7, username: 'alice' });
  assert.equal((await verifySessionToken(token))?.userId, 7);
  assert.ok((await verifySessionToken(token))?.authTime);
  assert.equal(await verifySessionToken(`${token.slice(0, -8)}tampered`), null);
  assert.equal(await verifySessionToken('not-a-jwt'), null);
  const { SignJWT } = await import('jose');
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const expired = await new SignJWT({ userId: 7, username: 'alice' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime(1).sign(key);
  assert.equal(await verifySessionToken(expired), null);
  const invalid = await new SignJWT({ userId: -7, username: 'alice' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('7d').sign(key);
  assert.equal(await verifySessionToken(invalid), null);
  delete process.env.JWT_SECRET;
  assert.equal(await verifySessionToken(token), null);
  await assert.rejects(() => signSessionToken({ id: 7, username: 'alice' }));
});

test('legacy session-token exports use canonical verification without a fallback key', async () => {
  const previous = process.env.JWT_SECRET;
  try {
    process.env.JWT_SECRET = 'auth-unit-test-only-secret-minimum-32-bytes';
    const { getSessionVerificationKey, verifySessionToken: verifyLegacyToken } = await import('../lib/session-token');
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ userId: 7, username: 'alice' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('7d').sign(getSessionVerificationKey());
    assert.equal((await verifySessionToken(token))?.userId, 7);
    assert.equal((await verifySessionToken(token))?.authTime, undefined);
    assert.equal(await verifyLegacyToken(token), true);
    const tooOld = await new SignJWT({ userId: 7, username: 'alice' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 8 * 86400).setExpirationTime('1d').sign(getSessionVerificationKey());
    assert.equal(await verifyLegacyToken(tooOld), false);
    delete process.env.JWT_SECRET;
    assert.throws(() => getSessionVerificationKey(), /JWT_SECRET/);
    assert.equal(await verifyLegacyToken(token), false);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

test('auth store adapts remote text credentials without replacing schema or legacy handles', () => {
  const database = new Database(':memory:');
  try {
    database.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '');
      CREATE TABLE authenticators (credential_id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
        device_type TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0);
      INSERT INTO users VALUES (1, 'alice', 'Alice');
      INSERT INTO authenticators VALUES ('legacy-key', 1, 'AQI', 0, '[]', 'singleDevice', 0);
    `);
    const store = createAuthStore(database);
    assert.equal(store.findUser('ALICE')?.id, 1);
    assert.throws(() => store.register('ALICE', 'duplicate', { id: 'duplicate-key', publicKey: new Uint8Array([1]), counter: 0 }), /taken/);
    assert.equal(store.handle(1), Buffer.from('1').toString('base64url'));
    assert.deepEqual(store.credential('legacy-key', 1)?.credential_public_key, Buffer.from([1, 2]));
    assert.equal(store.credential('legacy-key', 2), undefined);
    store.updateCounter(store.credential('legacy-key', 1)!, 1);
    assert.equal(store.credential('legacy-key', 1)?.counter, 1);
    const user = store.register('bob', 'opaque-b', { id: 'bob-key', publicKey: new Uint8Array([3, 4]), counter: 0 });
    assert.equal(store.handle(user.id), 'opaque-b');
    assert.deepEqual(store.credentials(user.id)[0].credential_public_key, Buffer.from([3, 4]));
    store.enroll(user.id, { id: 'extra-key', publicKey: new Uint8Array([5, 6]), counter: 0 });
    assert.equal(store.credentials(user.id).length, 2);
    assert.equal(createAuthStore(database).handle(1), Buffer.from('1').toString('base64url'));
    assert.deepEqual(database.prepare('SELECT display_name FROM users WHERE id = 1').get(), { display_name: 'Alice' });
  } finally { database.close(); }
});

test('proxy protects pages and remote API matchers using canonical tokens without a database import', async () => {
  const previous = { JWT_SECRET: process.env.JWT_SECRET, DEMO_MODE: process.env.DEMO_MODE };
  try {
    process.env.JWT_SECRET = 'auth-unit-test-only-secret-minimum-32-bytes';
    delete process.env.DEMO_MODE;
    const { NextRequest } = await import('next/server');
    const { proxy, config } = await import('../proxy');
    assert.deepEqual(config.matcher, ['/', '/calendar/:path*', '/api/todos/:path*', '/api/holidays/:path*']);
    for (const path of ['/', '/calendar', '/calendar/week']) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), 'http://localhost:3000/login');
    }
    assert.equal((await proxy(new NextRequest('http://localhost:3000/api/todos'))).status, 401);
    const token = await signSessionToken({ id: 1, username: 'alice' });
    assert.equal((await proxy(new NextRequest('http://localhost:3000/calendar', {
      headers: { cookie: `session=${token}` },
    }))).headers.get('x-middleware-next'), '1');
    delete process.env.JWT_SECRET;
    assert.equal((await proxy(new NextRequest('http://localhost:3000/calendar', {
      headers: { cookie: `session=${token}` },
    }))).status, 307);
  } finally {
    for (const key of ['JWT_SECRET', 'DEMO_MODE'] as const) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});