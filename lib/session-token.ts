import { verifySessionToken as verifyCanonicalToken } from './auth-token';

export function getSessionVerificationKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return new TextEncoder().encode(secret);
}

export async function verifySessionToken(token: string) {
  return (await verifyCanonicalToken(token)) !== null;
}