import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { consumeChallenge, findAuthenticator, findUserByUsername, updateAuthenticatorCounter } from '@/lib/db';
import { createSession, getWebAuthnConfig } from '@/lib/auth';

const schema = z.object({ username: z.string().trim().min(3).max(40), response: z.record(z.string(), z.unknown()) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid authentication response.' }, { status: 400 });
  const user = findUserByUsername(parsed.data.username.toLowerCase());
  if (!user) return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
  const expectedChallenge = consumeChallenge(user.id, 'authentication');
  const credentialId = typeof parsed.data.response.id === 'string' ? parsed.data.response.id : '';
  const authenticator = findAuthenticator(credentialId);
  if (!expectedChallenge || !authenticator || authenticator.user_id !== user.id) {
    return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
  }

  const { rpID, origin } = getWebAuthnConfig();
  try {
    const verification = await verifyAuthenticationResponse({
      response: parsed.data.response as never,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: authenticator.credential_id,
        publicKey: Buffer.from(authenticator.public_key, 'base64url'),
        counter: authenticator.counter,
        transports: JSON.parse(authenticator.transports),
      },
      requireUserVerification: false,
    });
    if (!verification.verified) return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    updateAuthenticatorCounter(authenticator.credential_id, verification.authenticationInfo.newCounter, verification.authenticationInfo.credentialBackedUp);
    await createSession(user);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
  }
}