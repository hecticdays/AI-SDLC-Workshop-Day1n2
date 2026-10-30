import { cookies } from 'next/headers';
import { demoEnabled, getDatabase } from './db';
import { signSessionToken, verifySessionToken } from './auth-token';

export interface Session {
  userId: number;
  username: string;
}
const COOKIE_NAME = 'session';

export async function getSession(): Promise<Session | null> {
  if (demoEnabled()) {
    const user = getDatabase().prepare("SELECT id, username FROM users WHERE username = 'Workshop demo'").get() as { id: number; username: string };
    return { userId: user.id, username: user.username };
  }
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (!token) return null;
    const session = await verifySessionToken(token);
    if (!session) return null;
    const user = getDatabase().prepare('SELECT username FROM users WHERE id = ?').get(session.userId) as { username: string } | undefined;
    return user ? { userId: session.userId, username: user.username } : null;
  } catch {
    return null;
  }
}

export async function createSession(user: { id: number; username: string }): Promise<void> {
  const token = await signSessionToken(user);
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400,
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0,
  });
}

export async function getRecentlyAuthenticatedSession(): Promise<Session | null> {
  if (demoEnabled()) return null;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const verified = token ? await verifySessionToken(token) : null;
  const now = Math.floor(Date.now() / 1000);
  if (!verified?.authTime || verified.authTime > now || now - verified.authTime > 300) return null;
  return getSession();
}