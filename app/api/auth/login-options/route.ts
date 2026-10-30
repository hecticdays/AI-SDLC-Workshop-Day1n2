import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { findUserByUsername, listAuthenticators, saveChallenge } from '@/lib/db';
import { getWebAuthnConfig } from '@/lib/auth';

const schema = z.object({ username: z.string().trim().min(3).max(40) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter your username.' }, { status: 400 });
  const user = findUserByUsername(parsed.data.username.toLowerCase());
  if (!user) return NextResponse.json({ error: 'Account or passkey not found.' }, { status: 404 });
  const authenticators = listAuthenticators(user.id);
  if (authenticators.length === 0) return NextResponse.json({ error: 'Account or passkey not found.' }, { status: 404 });

  const { rpID } = getWebAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: authenticators.map((credential) => ({
      id: credential.credential_id,
      transports: JSON.parse(credential.transports),
    })),
    userVerification: 'preferred',
  });
  saveChallenge(user.id, options.challenge, 'authentication');
  return NextResponse.json(options);
}