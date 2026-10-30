import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addAuthenticator, consumeChallenge, findUserByUsername } from '@/lib/db';
import { createSession, getWebAuthnConfig } from '@/lib/auth';

const schema = z.object({ username: z.string().trim().min(3).max(40), response: z.record(z.string(), z.unknown()) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid registration response.' }, { status: 400 });
  const user = findUserByUsername(parsed.data.username.toLowerCase());
  if (!user) return NextResponse.json({ error: 'Registration challenge expired.' }, { status: 400 });
  const expectedChallenge = consumeChallenge(user.id, 'registration');
  if (!expectedChallenge) return NextResponse.json({ error: 'Registration challenge expired.' }, { status: 400 });

  const { rpID, origin } = getWebAuthnConfig();
  try {
    const verification = await verifyRegistrationResponse({
      response: parsed.data.response as never,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ error: 'Passkey registration could not be verified.' }, { status: 400 });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    addAuthenticator({
      credentialId: credential.id,
      userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
    await createSession(user);
    return NextResponse.json({ verified: true });
  } catch {
    return NextResponse.json({ error: 'Passkey registration could not be verified.' }, { status: 400 });
  }
}