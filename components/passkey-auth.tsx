'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { KeyRound, Layers3 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type AuthMode = 'register' | 'login';

async function readError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'The request could not be completed.';
}

export function PasskeyAuth() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsBusy(true);
    try {
      if (mode === 'register') {
        const optionsResponse = await fetch('/api/auth/register-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, displayName }),
        });
        if (!optionsResponse.ok) throw new Error(await readError(optionsResponse));
        const attestation = await startRegistration({ optionsJSON: await optionsResponse.json() });
        const verification = await fetch('/api/auth/register-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, response: attestation }),
        });
        if (!verification.ok) throw new Error(await readError(verification));
      } else {
        const optionsResponse = await fetch('/api/auth/login-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
        if (!optionsResponse.ok) throw new Error(await readError(optionsResponse));
        const assertion = await startAuthentication({ optionsJSON: await optionsResponse.json() });
        const verification = await fetch('/api/auth/login-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, response: assertion }),
        });
        if (!verification.ok) throw new Error(await readError(verification));
      }
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Passkey authentication failed.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="brand" href="/">
          <span className="brand-icon"><Layers3 size={22} aria-hidden="true" /></span>
          Daybook
        </Link>
        <p className="eyebrow">A CALMER WAY TO PLAN</p>
        <h1 id="auth-title">Your day, in focus<span className="heading-dot">.</span></h1>
        <p className="muted">Sign in with a passkey to keep your tasks private and in sync.</p>

        <div className="segmented" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(null); }}>Create account</button>
          <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(null); }}>Sign in</button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="username">Username
            <input id="username" autoComplete="username webauthn" minLength={3} maxLength={40} required value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          {mode === 'register' && (
            <label htmlFor="display-name">Name
              <input id="display-name" autoComplete="name" maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
          )}
          {error && <p className="error-banner" role="alert">{error}</p>}
          <button className="button primary full-width" type="submit" disabled={isBusy}>
            <KeyRound size={16} aria-hidden="true" />
            {isBusy ? 'Waiting for passkey…' : mode === 'register' ? 'Create passkey' : 'Continue with passkey'}
          </button>
        </form>
        <p className="auth-note">Passkeys are stored with your device or password manager. Daybook never sees a password.</p>
      </section>
    </main>
  );
}