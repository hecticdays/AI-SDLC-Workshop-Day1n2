import type Database from 'better-sqlite3';
import { AuthError, opaqueToken, tokenHash } from './auth-security';

export type Operation = 'register' | 'login' | 'enroll';
export interface Attempt {
  browser: string;
  username: string;
  operation: Operation;
  challenge: string;
  handle: string;
  userId: number | null;
}
export interface Credential {
  credential_id: string;
  user_id: number;
  credential_public_key: Buffer;
  counter: number;
}
export interface AuthUser { id: number; username: string }
export const CHALLENGE_TTL = 300_000;

export function createAuthStore(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_handles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL, credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
    CREATE TABLE IF NOT EXISTS auth_attempts (
      id TEXT PRIMARY KEY, browser TEXT NOT NULL, username TEXT NOT NULL,
      operation TEXT NOT NULL, challenge TEXT NOT NULL, handle TEXT NOT NULL,
      user_id INTEGER, expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_attempt_expiry ON auth_attempts(expires);
    CREATE TABLE IF NOT EXISTS auth_limits (
      bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL
    );
  `);
  const columns = database.prepare('PRAGMA table_info(authenticators)').all() as { name: string }[];
  const legacyKeys = !columns.some(column => column.name === 'credential_public_key')
    && columns.some(column => column.name === 'public_key');
  const readCredential = (row: Credential & { public_key?: string }): Credential => legacyKeys
    ? { ...row, credential_public_key: Buffer.from(row.public_key!, 'base64url') } : row;
  const findUser = (username: string) => database.prepare(legacyKeys
    ? 'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
    : 'SELECT id, username FROM users WHERE username = ?')
    .get(username) as AuthUser | undefined;
  const credentials = (userId: number) => (database.prepare('SELECT * FROM authenticators WHERE user_id = ?')
    .all(userId) as Credential[]).map(readCredential);
  const addCredential = (userId: number, credential: { id: string; publicKey: Uint8Array; counter: number }) => {
    if (legacyKeys) {
      database.prepare(`INSERT INTO authenticators(user_id, credential_id, public_key, counter, device_type)
        VALUES (?, ?, ?, ?, ?)`).run(userId, credential.id, Buffer.from(credential.publicKey).toString('base64url'),
          credential.counter ?? 0, 'unknown');
      return;
    }
    database.prepare('INSERT INTO authenticators(user_id, credential_id, credential_public_key, counter) VALUES (?, ?, ?, ?)')
      .run(userId, credential.id, Buffer.from(credential.publicKey), credential.counter ?? 0);
  };
  return {
    findUser, credentials,
    handle(userId: number) {
      const handle = legacyKeys && credentials(userId).length
        ? Buffer.from(String(userId)).toString('base64url') : opaqueToken();
      database.prepare('INSERT INTO auth_handles(user_id, handle) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING')
        .run(userId, handle);
      return (database.prepare('SELECT handle FROM auth_handles WHERE user_id = ?').get(userId) as { handle: string }).handle;
    },
    saveAttempt(attempt: Attempt, now = Date.now()) {
      return database.transaction(() => {
        database.prepare('DELETE FROM auth_attempts WHERE expires <= ?').run(now);
        if ((database.prepare('SELECT count(*) AS total FROM auth_attempts').get() as { total: number }).total >= 10000) {
          throw new AuthError('Too many authentication attempts', 429);
        }
        const id = opaqueToken();
        database.prepare(`INSERT INTO auth_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(tokenHash(id), tokenHash(attempt.browser), attempt.username, attempt.operation,
            attempt.challenge, attempt.handle, attempt.userId, now + CHALLENGE_TTL);
        return id;
      })();
    },
    consumeAttempt(id: string, binding: Pick<Attempt, 'browser' | 'username' | 'operation' | 'userId'>, now = Date.now()) {
      return database.prepare(`DELETE FROM auth_attempts WHERE id = ? AND browser = ? AND username = ?
        AND operation = ? AND user_id IS ? AND expires > ? RETURNING challenge, handle, user_id AS userId`)
        .get(tokenHash(id), tokenHash(binding.browser), binding.username, binding.operation, binding.userId, now) as
        Pick<Attempt, 'challenge' | 'handle' | 'userId'> | undefined;
    },
    register(username: string, handle: string, credential: { id: string; publicKey: Uint8Array; counter: number }) {
      try {
        return database.transaction(() => {
          if (findUser(username)) throw new AuthError('Username already taken', 409);
          const result = database.prepare('INSERT INTO users(username) VALUES (?)').run(username);
          const id = Number(result.lastInsertRowid);
          database.prepare('INSERT INTO auth_handles VALUES (?, ?)').run(id, handle);
          addCredential(id, credential);
          return { id, username };
        }).immediate();
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new AuthError('Username or passkey already registered', 409);
        }
        throw error;
      }
    },
    enroll(userId: number, credential: { id: string; publicKey: Uint8Array; counter: number }) {
      try { addCredential(userId, credential); }
      catch { throw new AuthError('Passkey already registered', 409); }
    },
    credential(id: string, userId: number) {
      const row = database.prepare('SELECT * FROM authenticators WHERE credential_id = ? AND user_id = ?')
        .get(id, userId) as Credential | undefined;
      return row ? readCredential(row) : undefined;
    },
    updateCounter(credential: Credential, next: number) {
      const previous = credential.counter ?? 0;
      if (next < previous || (previous > 0 && next === previous)) throw new AuthError('Invalid authenticator counter', 401);
      const result = database.prepare(`UPDATE authenticators SET counter = ? WHERE credential_id = ?
        AND user_id = ? AND counter = ?`).run(next ?? 0, credential.credential_id, credential.user_id, previous);
      if (!result.changes) throw new AuthError('Concurrent authentication; please retry', 401);
    },
    limit(bucket: string, maximum: number, now = Date.now()) {
      database.transaction(() => {
        database.prepare('DELETE FROM auth_limits WHERE expires <= ?').run(now);
        const key = tokenHash(bucket);
        const existing = database.prepare('SELECT count FROM auth_limits WHERE bucket = ?').get(key) as { count: number } | undefined;
        if (existing && existing.count >= maximum) throw new AuthError('Too many attempts; try again shortly', 429);
        if (!existing && (database.prepare('SELECT count(*) AS total FROM auth_limits').get() as { total: number }).total >= 10000) {
          throw new AuthError('Too many attempts; try again shortly', 429);
        }
        database.prepare(`INSERT INTO auth_limits VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1`)
          .run(key, now + 60_000);
      }).immediate();
    },
  };
}