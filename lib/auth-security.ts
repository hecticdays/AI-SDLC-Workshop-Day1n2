import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export class AuthError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production' && (!env.APP_ORIGIN || !env.WEBAUTHN_RP_ID)) {
    throw new AuthError('Authentication is not configured', 503);
  }
  const origin = env.APP_ORIGIN ?? 'http://localhost:3000';
  const url = new URL(origin);
  const rpID = env.WEBAUTHN_RP_ID ?? url.hostname;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) ||
      !(url.hostname === rpID || url.hostname.endsWith(`.${rpID}`))) {
    throw new AuthError('Authentication is not configured', 503);
  }
  return { origin, rpID };
}

export function assertTrustedRequest(request: Request, config = authConfig()) {
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.get('origin') !== config.origin || (site && site !== 'same-origin')) {
    throw new AuthError('Untrusted request origin', 400);
  }
}

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

export function requestAddress(request: Request) {
  if (process.env.AUTH_TRUST_PROXY !== 'true') return undefined;
  const address = request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  return address && isIP(address) ? address : undefined;
}