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