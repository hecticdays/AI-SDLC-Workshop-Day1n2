import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { demoEnabled, getDatabase } from './db';

export interface Session {
  userId: number;
  username: string;
}
const sessionSchema = z.object({ userId: z.number().int().positive(), username: z.string().min(1) });
const COOKIE_NAME = 'session';

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return new TextEncoder().encode(secret);
}

export async function getSession(): Promise<Session | null> {
  if (demoEnabled()) {
    const user = getDatabase().prepare("SELECT id, username FROM users WHERE username = 'Workshop demo'").get() as { id: number; username: string };
    return { userId: user.id, username: user.username };
  }
  try {
    const token = (await cookies()).get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], requiredClaims: ['exp', 'iat'] });
    const session = sessionSchema.parse(payload);
    const user = getDatabase().prepare('SELECT username FROM users WHERE id = ?').get(session.userId) as { username: string } | undefined;
    return user ? { userId: session.userId, username: user.username } : null;
  } catch {
    return null;
  }
}

export async function createSession(user: { id: number; username: string }): Promise<void> {
  const token = await new SignJWT({ userId: user.id, username: user.username })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(signingKey());
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7 * 86400,
  });
}

export async function deleteSession(): Promise<void> {
  (await cookies()).set(COOKIE_NAME, '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0,
  });
}