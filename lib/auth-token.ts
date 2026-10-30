import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

const claims = z.object({
  userId: z.number().int().positive(), username: z.string().min(1),
  authTime: z.number().int().positive().optional(),
});

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(user: { id: number; username: string }) {
  return new SignJWT({ userId: user.id, username: user.username, authTime: Math.floor(Date.now() / 1000) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(signingKey());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ['HS256'], requiredClaims: ['exp', 'iat'], maxTokenAge: '7d',
    });
    return claims.parse(payload);
  } catch { return null; }
}

export function assertSessionConfigured() { signingKey(); }