import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getSessionVerificationKey } from '@/lib/session-token';

const cookieName = 'todo_session';
const sessionDurationSeconds = 7 * 24 * 60 * 60;

export async function createSession(userId: number) {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${sessionDurationSeconds}s`)
    .sign(getSessionVerificationKey());

  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionDurationSeconds,
  });
}

export async function getSession(): Promise<{ userId: number } | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSessionVerificationKey());
    const userId = Number(payload.userId);
    return Number.isInteger(userId) && userId > 0 ? { userId } : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(cookieName);
}

export function getWebAuthnConfig() {
  return {
    rpName: process.env.RP_NAME ?? 'Daymark Todo',
    rpID: process.env.RP_ID ?? 'localhost',
    origin: process.env.RP_ORIGIN ?? 'http://localhost:3000',
  };
}