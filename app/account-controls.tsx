'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { KeyRound, LogOut } from 'lucide-react';
import { authMessage, authPost } from '@/lib/auth-client';

export default function AccountControls({ demo }: { demo: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const router = useRouter();

  async function perform(action: 'logout' | 'enroll') {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'logout') {
        await authPost('logout');
        router.replace('/login');
        router.refresh();
      } else {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!response.ok) throw new Error('Sign in again before adding a passkey.');
        const { username } = await response.json();
        const assertion = await startAuthentication({ optionsJSON: await authPost<PublicKeyCredentialRequestOptionsJSON>('login-options', { username }) });
        await authPost('login-verify', { username, response: assertion });
        const attestation = await startRegistration({ optionsJSON: await authPost<PublicKeyCredentialCreationOptionsJSON>('enroll-options') });
        await authPost('enroll-verify', { response: attestation });
        setMessage('Passkey added.');
      }
    } catch (failure) { setError(authMessage(failure)); }
    finally { pending.current = false; setBusy(false); }
  }

  if (demo) return <span className="demo-label">Demo</span>;
  return <div aria-busy={busy} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
    <button className="button secondary" type="button" disabled={busy} onClick={() => void perform('enroll')}><KeyRound size={15} aria-hidden="true" />Add passkey</button>
    <button className="button secondary" type="button" disabled={busy} onClick={() => void perform('logout')}><LogOut size={15} aria-hidden="true" />Logout</button>
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Please wait...</p>}
    {error && <p role="alert" style={{ color: 'var(--danger)', flexBasis: '100%', overflowWrap: 'anywhere' }}>{error}</p>}
  </div>;
}