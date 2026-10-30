import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { createSession, deleteSession, getRecentlyAuthenticatedSession } from './auth';
import { getDatabase, demoEnabled } from './db';
import { createAuthStore, type Operation, type AuthUser } from './auth-store';
import { AuthError, assertTrustedRequest, authConfig, opaqueToken, requestAddress } from './auth-security';
import { assertSessionConfigured } from './auth-token';

const usernameSchema = z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N}_. -]+$/u, 'Invalid username');
const bodySchema = z.object({ username: usernameSchema.optional(), response: z.unknown().optional() }).strict();
const credentialSchema = z.object({
  id: z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/),
  rawId: z.string().min(1).max(2048), type: z.literal('public-key'),
  response: z.object({ clientDataJSON: z.string().min(1) }).passthrough(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
}).passthrough();
const assertionSchema = credentialSchema.extend({ response: credentialSchema.shape.response.extend({
  authenticatorData: z.string().min(1), signature: z.string().min(1), userHandle: z.string().nullable().optional(),
}) });
const attestationSchema = credentialSchema.extend({ response: credentialSchema.shape.response.extend({
  attestationObject: z.string().min(1),
}) });
const browserCookie = 'auth_browser';
const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/',
};
const validToken = (token?: string) => !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
const attemptCookie = (operation: Operation) => `auth_attempt_${operation}`;

async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AuthError('Expected JSON request');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError('Invalid request');
  const decoder = new TextDecoder();
  let length = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new AuthError('Request too large'); }
      text += decoder.decode(value, { stream: true });
    }
    return bodySchema.parse(JSON.parse(text + decoder.decode()));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Invalid request');
  } finally { reader.releaseLock(); }
}

async function account(operation: Operation, username: string | undefined, store: ReturnType<typeof createAuthStore>) {
  if (operation === 'enroll') {
    const session = await getRecentlyAuthenticatedSession();
    if (!session) throw new AuthError('Sign in again before adding a passkey', 401);
    return { id: session.userId, username: session.username };
  }
  const name = usernameSchema.parse(username);
  const user = store.findUser(name);
  if (operation === 'register') {
    if (user) throw new AuthError('Username already taken', 409);
    return { id: null, username: name };
  }
  if (!user || !store.credentials(user.id).length) throw new AuthError('Account or passkey not found', 404);
  return user;
}

async function options(operation: Operation, user: { id: number | null; username: string }, browser: string,
  store: ReturnType<typeof createAuthStore>, config: ReturnType<typeof authConfig>) {
  const handle = user.id === null ? opaqueToken() : store.handle(user.id);
  const credentials = user.id === null ? [] : store.credentials(user.id);
  const generated = operation === 'login'
    ? await generateAuthenticationOptions({ rpID: config.rpID, userVerification: 'required', timeout: 60000,
      allowCredentials: credentials.map(credential => ({ id: credential.credential_id })) })
    : await generateRegistrationOptions({ rpName: 'Daybook', rpID: config.rpID, userName: user.username,
      userID: isoBase64URL.toBuffer(handle), attestationType: 'none', timeout: 60000,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: credentials.map(credential => ({ id: credential.credential_id })) });
  const id = store.saveAttempt({ browser, username: user.username, operation,
    challenge: generated.challenge, handle, userId: user.id });
  const response = NextResponse.json(generated);
  response.cookies.set(browserCookie, browser, { ...cookieOptions, maxAge: 7 * 86400 });
  response.cookies.set(attemptCookie(operation), id, { ...cookieOptions, maxAge: 300 });
  return response;
}

async function verify(operation: Operation, user: { id: number | null; username: string }, browser: string,
  input: unknown, store: ReturnType<typeof createAuthStore>, config: ReturnType<typeof authConfig>) {
  const jar = await cookies();
  const id = jar.get(attemptCookie(operation))?.value;
  if (!validToken(id)) throw new AuthError('Authentication attempt expired or invalid', 401);
  const attempt = store.consumeAttempt(id!, { browser, username: user.username, operation, userId: user.id });
  jar.set(attemptCookie(operation), '', { ...cookieOptions, maxAge: 0 });
  if (!attempt) throw new AuthError('Authentication attempt expired or invalid', 401);
  const parsed = credentialSchema.safeParse(input);
  if (!parsed.success) throw new AuthError('Passkey verification failed', 401);
  const expected = { expectedChallenge: attempt.challenge, expectedOrigin: config.origin,
    expectedRPID: config.rpID, requireUserVerification: true };
  if (operation === 'login') {
    const credential = store.credential(parsed.data.id, user.id!);
    if (!credential) throw new AuthError('Passkey verification failed', 401);
    const response = assertionSchema.parse(parsed.data) as AuthenticationResponseJSON;
    if (response.response.userHandle && response.response.userHandle !== attempt.handle) {
      throw new AuthError('Passkey verification failed', 401);
    }
    const result = await verifyAuthenticationResponse({ ...expected, response,
      credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.credential_public_key), counter: credential.counter ?? 0 } });
    if (!result.verified) throw new AuthError('Passkey verification failed', 401);
    store.updateCounter(credential, result.authenticationInfo.newCounter ?? 0);
    await createSession(user as AuthUser);
  } else {
    const result = await verifyRegistrationResponse({ ...expected, response: attestationSchema.parse(parsed.data) as RegistrationResponseJSON });
    if (!result.verified) throw new AuthError('Passkey verification failed', 401);
    const credential = { ...result.registrationInfo.credential, counter: result.registrationInfo.credential.counter ?? 0 };
    if (operation === 'register') {
      const registered = store.register(user.username, attempt.handle, credential);
      await createSession(registered);
    } else store.enroll(user.id!, credential);
  }
  return NextResponse.json({ success: true });
}

export async function authEndpoint(request: Request, operation: Operation | 'logout', phase: 'options' | 'verify' = 'options') {
  try {
    const config = authConfig();
    assertTrustedRequest(request, config);
    if (operation === 'logout') {
      await deleteSession();
      const response = NextResponse.json({ success: true });
      for (const purpose of ['register', 'login', 'enroll'] as const) {
        response.cookies.set(attemptCookie(purpose), '', { ...cookieOptions, maxAge: 0 });
      }
      response.cookies.set(browserCookie, '', { ...cookieOptions, maxAge: 0 });
      return response;
    }
    const store = createAuthStore(getDatabase());
    const existingBrowser = (await cookies()).get(browserCookie)?.value;
    const browser = validToken(existingBrowser) ? existingBrowser! : opaqueToken();
    const address = requestAddress(request);
    if (address) store.limit(`ip:${address}`, 300);
    store.limit(`browser:${browser}`, 60);
    if (demoEnabled()) throw new AuthError('Passkeys are unavailable in demo mode');
    try { assertSessionConfigured(); }
    catch { throw new AuthError('Authentication is not configured', 503); }
    const body = await readBody(request);
    const user = await account(operation, body.username, store);
    if (phase === 'options') return await options(operation, user, browser, store, config);
    if (!validToken(existingBrowser)) throw new AuthError('Authentication attempt expired or invalid', 401);
    return await verify(operation, user, browser, body.response, store, config);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : error instanceof z.ZodError ? 400 : 401;
    const message = error instanceof AuthError ? error.message : status === 400 ? 'Invalid request' : 'Passkey verification failed';
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}