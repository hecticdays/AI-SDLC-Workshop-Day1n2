'use client';

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
<<<<<<< HEAD
import { KeyRound, Layers3 } from 'lucide-react';
=======
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, LogIn } from 'lucide-react';
>>>>>>> 7d87ba976183962fc380a0203fbd8f3adc2c922a
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { authMessage, authPost } from '@/lib/auth-client';

export function PasskeyAuth() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const pending = useRef(false);

  async function authenticate(operation: 'login' | 'register') {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setIsBusy(true);
    try {
      const name = username.trim();
      if (!name) throw new Error('Enter your username.');
      const response = operation === 'register'
        ? await startRegistration({ optionsJSON: await authPost<PublicKeyCredentialCreationOptionsJSON>('register-options', { username: name }) })
        : await startAuthentication({ optionsJSON: await authPost<PublicKeyCredentialRequestOptionsJSON>('login-options', { username: name }) });
      await authPost(`${operation}-verify`, { username: name, response });
      router.replace('/');
      router.refresh();
    } catch (caught) {
      setError(authMessage(caught));
    } finally {
      pending.current = false;
      setIsBusy(false);
    }
  }

<<<<<<< HEAD
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
=======
  return <main style={{ maxWidth: 480, padding: '72px 24px', minHeight: '100dvh' }}>
    <Link href="/" className="brand" style={{ marginBottom: 48 }}><span className="brand-icon"><Fingerprint size={23} aria-hidden="true" /></span>Daybook</Link>
    <h1 style={{ fontSize: 28, marginBottom: 28 }}>Sign in</h1>
    <form aria-busy={isBusy} onSubmit={(event) => { event.preventDefault(); void authenticate('login'); }} style={{ display: 'grid', gap: 20 }}>
      <label htmlFor="username">Username
        <input id="username" name="username" autoComplete="username webauthn" autoCapitalize="none" spellCheck={false}
          required maxLength={64} value={username} disabled={isBusy} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button className="button primary" type="submit" disabled={isBusy || !username.trim()}><LogIn size={16} aria-hidden="true" />Login</button>
        <button className="button secondary" type="button" disabled={isBusy || !username.trim()} onClick={() => void authenticate('register')}><KeyRound size={16} aria-hidden="true" />Register</button>
      </div>
      {isBusy && <p role="status">Waiting for your passkey...</p>}
      {error && <p role="alert" style={{ color: 'var(--danger)', overflowWrap: 'anywhere' }}>{error}</p>}
    </form>
    <p style={{ color: 'var(--muted)', marginTop: 32, lineHeight: 1.7 }}>Keep a backup passkey. Account recovery is not available if all passkeys are lost.</p>
  </main>;
>>>>>>> 7d87ba976183962fc380a0203fbd8f3adc2c922a
}