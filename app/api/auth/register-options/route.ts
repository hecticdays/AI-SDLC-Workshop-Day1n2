import { generateRegistrationOptions } from '@simplewebauthn/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createUser, findUserByUsername, listAuthenticators, saveChallenge } from '@/lib/db';
import { getWebAuthnConfig } from '@/lib/auth';

const schema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(80),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid username and display name.' }, { status: 400 });

  const username = parsed.data.username.toLowerCase();
  let user = findUserByUsername(username);
  if (user && listAuthenticators(user.id).length > 0) {
    return NextResponse.json({ error: 'This account already has a passkey. Sign in instead.' }, { status: 409 });
  }
  if (!user) {
    try {
      user = createUser(username, parsed.data.displayName);
    } catch {
      return NextResponse.json({ error: 'Unable to create the account.' }, { status: 409 });
    }
  }

  const { rpID, rpName } = getWebAuthnConfig();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(String(user.id)),
    userName: user.username,
    userDisplayName: user.display_name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: listAuthenticators(user.id).map((credential) => ({
      id: credential.credential_id,
      transports: JSON.parse(credential.transports),
    })),
  });
  saveChallenge(user.id, options.challenge, 'registration');
  return NextResponse.json(options);
}