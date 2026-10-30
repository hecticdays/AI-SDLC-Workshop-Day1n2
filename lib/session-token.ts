export function getSessionVerificationKey() {
  const secret = process.env.JWT_SECRET
    ?? (process.env.NODE_ENV === 'production' ? '' : 'local-development-jwt-secret-change-before-deploy');
  if (new TextEncoder().encode(secret).length < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return new TextEncoder().encode(secret);
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function verifySessionToken(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0]))) as { alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1]))) as {
      exp?: number; iat?: number; userId?: number; username?: string;
    };
    if (header.alg !== 'HS256' || !Number.isInteger(payload.userId) || Number(payload.userId) < 1
      || typeof payload.username !== 'string' || payload.username.length === 0
      || typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) {
      return false;
    }
    const key = await crypto.subtle.importKey('raw', getSessionVerificationKey(), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}