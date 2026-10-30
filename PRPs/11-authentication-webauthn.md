# WebAuthn/Passkeys Authentication

Passwordless registration and login using WebAuthn/passkeys (biometrics, security keys, or platform authenticators), with JWT-backed sessions and Next.js 16 proxy protection.

## Implementation Status

**Last updated:** 2026-10-30. Complete (Person 5). Registration/login options and verification, authenticated additional-passkey enrollment (`POST /api/auth/enroll-options` and `/api/auth/enroll-verify`), logout and `/api/auth/me` are implemented. The login page supports retryable registration/login; account controls expose enrollment/logout. [proxy.ts](../proxy.ts) protects `/` and `/calendar`; APIs independently validate sessions and resource ownership. Route protection does not assert a completed calendar feature.

[lib/webauthn.ts](../lib/webauthn.ts) uses `@simplewebauthn/browser` 13.3.0 and `@simplewebauthn/server` 13.3.3, stable opaque account handles, account-scoped credentials, `counter ?? 0`, and required user verification in both options and server verification. [lib/auth-store.ts](../lib/auth-store.ts) persists unpredictable browser/account/operation-bound attempts in SQLite, with a 300-second TTL and atomic single-use consumption. Registration user/credential writes are atomic; counter updates reject stale concurrent writes. Origin and RP configuration are checked; anonymous registration cannot add a passkey to an existing account.

Enrollment requires a signed recent `authTime` in the five-minute window, not merely a valid seven-day session; sign in again when it is stale. Session cookies are HttpOnly, SameSite=Lax, path `/`, seven-day expiry, and Secure in production. Logout clears browser session/attempt cookies but does not revoke a copied JWT. There is no account recovery if all passkeys are lost.

Authentication has per-browser rate limits. IP buckets are enabled only with `AUTH_TRUST_PROXY=true` and a valid forwarded IP; the trusted upstream must strip/overwrite client forwarding headers and prevent direct untrusted access. Without that deployment configuration, do not claim IP/global abuse protection. Distinct unknown-account/duplicate-name responses still permit account enumeration.

Development requires a private `JWT_SECRET` of at least 32 bytes, `APP_ORIGIN=http://localhost:3000` and `WEBAUTHN_RP_ID=localhost`; use localhost, not an IP RP ID rejected by Chromium. Production requires HTTPS, matching public origin/RP, and stable private persistent SQLite (attempts and credentials share that storage). See [README.md](../README.md) for a secret-generation expression; do not use test secrets.

Evidence: [tests/auth.test.ts](../tests/auth.test.ts) and [tests/01-authentication.spec.ts](../tests/01-authentication.spec.ts). Combined verification: 35 unit/DB tests pass; loaded `lib/**` coverage is 87.53% lines / 89.25% branches / 88.73% functions; Next.js 16.4.3 build succeeds; 62 desktop/mobile Playwright cases pass (32 prior + 30 new). Virtual authenticators and isolated fixtures provide implementation evidence, not a production security audit, real-device certification, or proof of every success metric. Fixtures do not rely on authentication test-file order.

**Example precedence:** The original schema/handler/UI snippets below and their review are historical design references, not copy-ready SimpleWebAuthn 13 code. Current bound SQLite attempts, enrollment, UV/origin checks and `proxy.ts` supersede username-only challenge examples, old browser/server signatures and `middleware.ts` examples. Unticked checkboxes remain individual verification plans.

**Dependencies**: This is foundational infrastructure, not a downstream feature. The `session.userId` produced by `getSession()` here is required by every API route in PRPs 01–10 (`if (!session) return 401`). Per the PRP Index's Implementation Priority, it can be built in parallel with or after the other features — nothing else depends on its UI, but everything else depends on its session primitive existing before those routes can be authorized.

[← PRP Index](./README.md)

## Feature Overview

The app uses WebAuthn (passkeys) as the *only* authentication mechanism — there is no password field anywhere in the schema or UI. Users register with a username and their device's platform authenticator (Touch ID, Face ID, Windows Hello, PIN) or a roaming security key (YubiKey, etc.). Login re-authenticates the same way. A successful registration or login creates a JWT session stored in an HTTP-only cookie with a 7-day expiry. `proxy.ts` protects `/` and `/calendar`, redirecting unauthenticated requests to `/login`.

## User Stories

- **As a new user**, I want to register with just a username and my fingerprint/Face ID, so that I never have to create or remember a password.
- **As a returning user**, I want to log in with the same biometric prompt I used to register, so that access is fast and frictionless.
- **As a security-conscious user**, I want my credentials to never leave my device (no password stored server-side, no shared secret to leak), so that I'm protected even if the server's database is compromised.
- **As a user on a new device**, I want to register an additional passkey (e.g. my phone, after registering on my laptop), so that I'm not locked out of my account if one device is unavailable.
- **As a logged-in user**, I want my session to persist across page reloads and browser restarts for a reasonable period, so that I don't have to re-authenticate constantly.
- **As a user**, I want a visible logout control that immediately ends my session, so that I can secure a shared or public device.

## User Flow

### Registration
1. User navigates to `/login` (or is redirected there from a protected route).
2. User enters a username and clicks **Register**.
3. Client calls `POST /api/auth/register-options` with the username.
4. Server checks the username is not already taken, generates a WebAuthn challenge via `generateRegistrationOptions`, stores a browser/account/operation-bound SQLite attempt with 300-second expiry, and returns the options.
5. Client calls `startRegistration({ optionsJSON: options })` from `@simplewebauthn/browser`, which prompts the browser's platform authenticator (fingerprint/Face ID/PIN/security key).
6. Browser returns an attestation response; client POSTs it to `POST /api/auth/register-verify`.
7. Server calls `verifyRegistrationResponse`, and on success creates the `users` row and the corresponding `authenticators` row, then calls `createSession(user)`.
8. Server responds 200; client redirects to `/`.

### Login
1. User navigates to `/login`, enters their username, clicks **Login**.
2. Client calls `POST /api/auth/login-options` with the username; server looks up the user's registered authenticator(s), generates an assertion challenge via `generateAuthenticationOptions`, stores it, returns options.
3. Client calls `startAuthentication({ optionsJSON: options })`, prompting the same biometric/security-key flow.
4. Client POSTs the assertion response to `POST /api/auth/login-verify`.
5. Server looks up the authenticator by `credential_id`, calls `verifyAuthenticationResponse`, updates the authenticator's `counter`, calls `createSession(user)`.
6. Server responds 200; client redirects to `/`.

### Session & Logout
1. On every page load of `/` or `/calendar`, `proxy.ts` checks for a valid session token; if missing/invalid, redirects to `/login`. APIs separately check the account and ownership.
2. `/login` itself checks `GET /api/auth/me`; if already authenticated, redirects to `/`.
3. User clicks **Logout** (top-right corner) → `POST /api/auth/logout` clears the cookie → redirect to `/login`.

## Technical Requirements

### Database Schema

This PRP owns the `users` and `authenticators` tables:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE authenticators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT UNIQUE NOT NULL,
  credential_public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_authenticators_user_id ON authenticators(user_id);
```

A user may have multiple rows in `authenticators` (one per registered device) — this is a one-to-many relationship, not one-to-one.

### Types

```typescript
export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  created_at: string;
}

export interface Session {
  userId: number;
  username: string;
}
```

### `lib/auth.ts`

```typescript
export async function createSession(user: User): Promise<void>;
// Signs a JWT { userId, username }, sets it as an HTTP-only, SameSite=Lax,
// Secure-in-production cookie with a 7-day expiry.

export async function getSession(): Promise<Session | null>;
// Reads the session cookie, verifies the JWT, returns the decoded session
// or null if absent/invalid/expired. Called first in every protected API route.

export async function deleteSession(): Promise<void>;
// Clears the session cookie immediately (logout).
```

### API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/auth/register-options` | Generate a WebAuthn registration challenge for a username |
| POST | `/api/auth/register-verify` | Verify the registration attestation, create `users`/`authenticators` rows, create session |
| POST | `/api/auth/login-options` | Generate a WebAuthn authentication challenge for a username |
| POST | `/api/auth/login-verify` | Verify the authentication assertion, update `counter`, create session |
| POST | `/api/auth/enroll-options` | Generate additional-passkey options for the recently authenticated account |
| POST | `/api/auth/enroll-verify` | Verify and attach a passkey to that same recently authenticated account |
| POST | `/api/auth/logout` | Clear the session cookie |
| GET | `/api/auth/me` | Return the current session's user, or 401 |

### WebAuthn Flow (4 steps, applies to both register and login)

1. Client requests options from the server (`*-options` endpoint) → server generates and persists a random challenge.
2. Client hands the options to `@simplewebauthn/browser`'s `startRegistration()`/`startAuthentication()`, which drives the platform authenticator UI.
3. Client POSTs the browser's response to the `*-verify` endpoint.
4. Server verifies the response against the stored challenge using `@simplewebauthn/server`, persists/updates the authenticator, and establishes a session.

```typescript
// app/api/auth/register-options/route.ts
export async function POST(request: NextRequest) {
  const { username } = await request.json();
  if (userDB.findByUsername(username)) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
  }
  const options = await generateRegistrationOptions({
    rpName: process.env.RP_NAME!,
    rpID: process.env.RP_ID!,
    userName: username,
    attestationType: 'none',
  });
  await challengeStore.save(username, options.challenge);
  return NextResponse.json(options);
}
```

```typescript
// app/api/auth/login-verify/route.ts
export async function POST(request: NextRequest) {
  const { username, response } = await request.json();
  const authenticator = authenticatorDB.findByCredentialId(response.id);
  if (!authenticator) {
    return NextResponse.json({ error: 'Authenticator not recognized' }, { status: 401 });
  }

  const expectedChallenge = await challengeStore.get(username);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: process.env.RP_ORIGIN!,
    expectedRPID: process.env.RP_ID!,
    authenticator: {
      credentialID: isoBase64URL.toBuffer(authenticator.credential_id),
      credentialPublicKey: authenticator.credential_public_key,
      // Always coalesce — counter can be undefined on some authenticator records.
      counter: authenticator.counter ?? 0,
    },
  });

  if (!verification.verified) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
  }

  authenticatorDB.updateCounter(authenticator.id, verification.authenticationInfo.newCounter ?? 0);
  const user = userDB.findById(authenticator.user_id);
  await createSession(user);
  return NextResponse.json({ success: true });
}
```

**Critical pitfall — `counter ?? 0`:** `authenticator.counter` can come back `undefined` from the database layer or from a fresh authenticator record. Every place `counter` is read — building the `verifyAuthenticationResponse` argument, computing the new counter, storing it — must use `?? 0`. This was a real bug previously fixed at two call sites in `app/api/auth/login-verify/route.ts`. Never assume `counter` is a number without the guard.

**Buffer/encoding requirement:** `credential_id` is stored as text but WebAuthn APIs operate on buffers with base64url encoding. Use `isoBase64URL` from `@simplewebauthn/server/helpers` for all conversions between the stored string form and the buffer form the verification functions expect. Mixing base64 and base64url encodings is a common source of "authenticator not recognized" bugs.

### Historical Route Protection Example (`middleware.ts`; superseded by `proxy.ts`)

```typescript
export async function middleware(request: NextRequest) {
  const protectedPaths = ['/', '/calendar'];
  if (protectedPaths.includes(request.nextUrl.pathname)) {
    const session = await getSession();
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/calendar'],
};
```

Every other feature's API routes follow the same first-line pattern:

```typescript
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  // use session.userId for all DB queries
}
```

## UI Components

### `/login` page

```tsx
'use client';
import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRegister() {
    setError(null);
    const optionsRes = await fetch('/api/auth/register-options', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    if (!optionsRes.ok) return setError((await optionsRes.json()).error);
    const options = await optionsRes.json();

    const attestation = await startRegistration(options);

    const verifyRes = await fetch('/api/auth/register-verify', {
      method: 'POST',
      body: JSON.stringify({ username, response: attestation }),
    });
    if (!verifyRes.ok) return setError((await verifyRes.json()).error);
    router.push('/');
  }

  async function handleLogin() {
    setError(null);
    const optionsRes = await fetch('/api/auth/login-options', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    if (!optionsRes.ok) return setError((await optionsRes.json()).error);
    const options = await optionsRes.json();

    const assertion = await startAuthentication(options);

    const verifyRes = await fetch('/api/auth/login-verify', {
      method: 'POST',
      body: JSON.stringify({ username, response: assertion }),
    });
    if (!verifyRes.ok) return setError((await verifyRes.json()).error);
    router.push('/');
  }

  return (
    <div>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      {error && <p role="alert">{error}</p>}
      <button onClick={handleRegister}>Register</button>
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}
```

### Logout button

```tsx
async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  router.push('/login');
}
// Rendered top-right of the main app layout, visible on all authenticated pages.
```

## Edge Cases

- **Username already taken on register** → `register-options` returns 409 before a challenge is even generated.
- **Login with unregistered username** → `login-options` returns 404/400 rather than leaking whether other usernames exist (avoid confirming valid usernames where practical).
- **No authenticator found for a `credential_id` on login-verify** → 401, generic "Authenticator not recognized" message.
- **Authenticator counter regression** — `verifyAuthenticationResponse` rejects if the assertion's counter is not greater than the stored counter (a classic sign of a cloned authenticator), *except* when both are 0, since some authenticators (e.g. certain platform authenticators) never increment the counter and always report 0.
- **`counter` is `undefined`** on a freshly-read authenticator row — always guard with `?? 0` (see Technical Requirements).
- **JWT cookie expired or tampered** — `getSession()` must fail closed (return `null`), never throw uncaught, so middleware and API routes correctly treat it as unauthenticated.
- **Browser/device does not support WebAuthn** — `startRegistration`/`startAuthentication` throw; catch and show a clear "your browser/device doesn't support passkeys" message rather than a raw exception.
- **User cancels the biometric/security-key prompt** — the promise from `startRegistration`/`startAuthentication` rejects (`NotAllowedError`); treat as a cancellation, not an error, and let the user retry without wiping their typed username.
- **Multiple authenticators per user** — a user registering a second device (e.g. phone after laptop) creates a second `authenticators` row for the same `user_id`; login must succeed with *any* of the user's registered authenticators, and `login-options` should include all of the user's `credential_id`s as `allowCredentials`.
- **Challenge replay/expiry** — a stored registration/login challenge must be single-use and short-lived; reject verification attempts against an already-consumed or expired challenge.
- **Race between register and route protection** — a user completing registration must have `createSession` succeed *before* the client redirects to `/`, or middleware will bounce them back to `/login`.

## Acceptance Criteria

- [ ] Registration creates a `users` row and at least one `authenticators` row on success
- [ ] Registration rejects duplicate usernames with a 409 before generating a challenge
- [ ] Login succeeds only with a previously-registered authenticator for that username
- [ ] Login updates the authenticator's `counter` on every successful assertion
- [ ] `counter` is never read or written without a `?? 0` fallback anywhere in the auth code path
- [ ] A successful register or login sets an HTTP-only session cookie with a 7-day expiry
- [ ] `GET /api/auth/me` returns the current user when authenticated, 401 otherwise
- [ ] `POST /api/auth/logout` clears the session cookie and subsequent requests are treated as unauthenticated
- [ ] `proxy.ts` redirects unauthenticated requests to `/` and `/calendar` to `/login`
- [ ] `/login` redirects an already-authenticated user to `/`
- [ ] A user can register a second authenticator (second device) and log in with either
- [ ] Session persists across a full page reload and a browser restart within the 7-day window

## Testing Requirements

Test file: `tests/01-authentication.spec.ts`. Each suite provisions its own authenticated state; numbering is not an execution-order dependency. Authentication cases use virtual WebAuthn authenticators through Chromium DevTools Protocol, and `timezoneId: 'Asia/Singapore'` is set globally in `playwright.config.ts`.

**E2E tests:**
- [ ] Register a new user with a virtual authenticator, verify redirect to `/`
- [ ] Register with a username that already exists, verify error message shown, no navigation
- [ ] Login with a previously-registered virtual authenticator, verify redirect to `/`
- [ ] Login with an unregistered username, verify error shown
- [ ] Logout, verify redirect to `/login` and that navigating back to `/` redirects to `/login` again
- [ ] Reload the page after login, verify session persists (still on `/`, not bounced to `/login`)
- [ ] Navigate directly to `/calendar` while unauthenticated, verify redirect to `/login`
- [ ] Navigate to `/login` while already authenticated, verify redirect to `/`
- [ ] Register a second authenticator for the same username, verify login succeeds with either

**Unit tests:**
- [ ] `createSession`/`getSession`/`deleteSession` round-trip (create → read back matches → delete → read returns null)
- [ ] JWT verification rejects a tampered token
- [ ] JWT verification rejects an expired token
- [ ] Counter-regression check rejects a replayed assertion with a stale (non-zero, non-incrementing) counter
- [ ] Counter comparison logic correctly allows repeated `0` counters (authenticators that don't support counting)

## Out of Scope

- Password-based login as a fallback or alternative to passkeys
- Social/OAuth login (Google, GitHub, etc.)
- Multi-factor authentication beyond the passkey itself
- Account recovery when a user loses their only registered passkey — this is a real, currently-unaddressed gap (no recovery codes, no email-based reset) and should be flagged to stakeholders rather than silently assumed solved
- Email verification or email-based communication of any kind
- Admin/user-management UI (listing, disabling, or deleting other users' accounts)
- Comprehensive distributed abuse protection (implemented browser buckets and opt-in trusted-proxy IP buckets are not a production-wide security certification)

## Success Metrics

- Registration and login flows each complete in under 5 seconds end-to-end, including the biometric/security-key prompt
- Zero session-fixation or replay vulnerabilities in security review (counter-regression check verified effective)
- 7-day session expiry is enforced consistently — no session observed valid past 7 days, no session invalidated early
- 100% of protected-route API requests without a valid session return 401, with no data leakage in the response body
- Users can register and authenticate from at least two different device/authenticator combinations without errors

## Person 5 Evaluation

**Historical review status:** Requirements evaluation complete; rechecked at `a3b4feb`, when passkey handlers and dedicated tests were absent. The handoffs/findings below are preserved as historical context; the current implementation status above supersedes their missing-feature assessment. Neither the review nor current tests constitute production security verification; unticked proposed criteria are not blanket completion claims.

### Current Resolution and Follow-up

AUTH-01/02/03 are addressed by recent-auth enrollment and account/browser/operation-bound expiring single-use attempts. AUTH-04/05 are addressed by required UV, stable handles, origin/RP checks and pinned SimpleWebAuthn 13 packages. AUTH-06/07 are addressed by atomic registration/counter handling, retryable pending UI and independent test fixtures. AUTH-08 now has explicit cookie/claim validation and browser-local logout; server-side JWT revocation remains excluded. AUTH-09 uses Next.js 16 proxy protection and conditional trusted-proxy IP buckets, but account enumeration, real-device breadth and prompt-inclusive latency are not certified. Recovery remains excluded. Production must provision HTTPS, private secrets and persistent private SQLite plus trusted upstream resource/header handling.

### Historical Implementation Handoff (at `a3b4feb`)

- **Session contract available:** [lib/auth.ts](../lib/auth.ts) exports `getSession(): Promise<Session | null>` with `{ userId, username }`. Normal cookie authentication verifies HS256, requires `exp` and `iat`, validates session fields, and checks that the account still exists. Resource handlers must still authorize ownership themselves.
- **AUTH-08 partly addressed in source:** `JWT_SECRET` requires at least 32 bytes; session cookies use HttpOnly, SameSite=Lax, path `/`, production Secure, and seven-day expiry. Deletion matches cookie attributes. Logout clears the browser cookie but does not revoke a copied JWT; revocation policy and dedicated tests remain open. The PRP examples still need alignment with this implementation.
- **Passkey persistence missing:** [lib/db.ts](../lib/db.ts) has users but no authenticator/challenge tables or account-stable WebAuthn user-handle contract. The existing session helper does not establish a passkey enrollment or verification flow; AUTH-01 through AUTH-07 remain implementation requirements.
- **Demo is not authentication evidence:** Session lookup bypasses cookies only when development mode, `DEMO_MODE=true`, and `DATABASE_PATH=demo.db` all hold. Run authentication and unauthenticated-access checks with this explicit demo mode disabled.
- **Fixture boundary:** [tests/helpers.ts](../tests/helpers.ts) currently provisions database users and signs test JWTs for Person 4, including foreign-owned resources. It is not a virtual-authenticator fixture and does not prove registration, passkey login, or two independent authenticated browser contexts. Reuse its session setup where appropriate, then add dedicated WebAuthn and two-context fixtures for all owners.
- **Verification remaining:** Implement registration, login, additional-passkey enrollment, logout routing, and protected-page behavior with the challenge/account-binding decisions below. Do not mark the feature complete based on the existing `/api/auth/me` route or session functions alone.

### Findings

| ID | Severity | Evidence and impact | Required clarification or change |
|---|---|---|---|
| AUTH-01 | High | A second passkey is required by the stories, edge cases, and acceptance criteria, but registration rejects an existing username and always creates a user. No authenticated enrollment endpoint or flow is defined. | Define enrollment for the current authenticated user, preferably with recent reauthentication. Bind options/verification to `session.userId`; an anonymous caller knowing a username must never attach a credential. Use an existing passkey on a new device to establish access; lost-only-passkey recovery remains out of scope. |
| AUTH-02 | High | Challenges are keyed only by username in the example. There is no browser/attempt binding, explicit lifetime, or atomic consumption, despite the single-use requirement. Parallel attempts can overwrite state and concurrent verification can reuse it. | Define a short TTL and an unpredictable attempt identifier bound to the initiating browser, operation, and account. Atomically consume the challenge on verification and reject missing, expired, wrong-flow, and replayed attempts. Keep state available across deployed instances/restarts as required by the hosting model. |
| AUTH-03 | High | `login-verify` selects a credential globally by `response.id` and reads the challenge by submitted username, but never checks that the credential belongs to that username's user. This does not satisfy the username-bound login criterion. | Resolve the account from the bound attempt, require matching `authenticator.user_id`, and create the session only for that account after successful verification. Test user A's challenge with user B's credential and verify no session or counter write occurs. |
| AUTH-04 | High | The examples leave user-verification policy implicit and do not specify an account-stable WebAuthn user handle. Cookie flags alone also do not define CSRF protection for state-changing endpoints. | Explicitly require user verification in generated options and server verification if biometrics/PIN are the intended assurance. Specify a stable opaque user handle, trusted RP/origin configuration, and origin/CSRF checks for state-changing requests, including enrollment and logout. |
| AUTH-05 | Medium | SimpleWebAuthn package versions are not pinned, while snippets use version-sensitive browser arguments and the server's `authenticator` verification shape. | Select compatible package versions and validate their TypeScript signatures before copying snippets; use the supported credential/public-key representation and preserve the `counter ?? 0` requirement. |
| AUTH-06 | Medium | The duplicate-username check occurs before verification. Concurrent registrations can both pass it; separate user/credential inserts can leave an orphan user after failure. Counter/session operations have no concurrency policy either. | Transactionally create user and credential, translate uniqueness conflicts to 409, and define atomic challenge/counter handling so concurrent verification cannot accept a stale assertion. |
| AUTH-07 | Medium | UI handlers have no exception handling or busy state despite cancellation, unsupported-browser, and retry requirements. The proposed tests assume authentication tests running first will authenticate other suites. | Catch browser/network failures, preserve username, and prevent duplicate submissions. Give each dependent suite an explicit authenticated fixture/setup; Playwright file numbering is not an authentication dependency or shared session guarantee. |
| AUTH-08 | Medium | JWT signing configuration/claim validation and cookie path are unspecified. Clearing a cookie does not revoke a copied JWT, so 'subsequent requests are unauthenticated' is ambiguous. | Define secret provisioning with no insecure default, accepted algorithm, claim validation, cookie path `/`, and matching deletion attributes. Decide whether logout is browser-local or requires server-side revocation, then test that exact guarantee. |
| AUTH-09 | Low | The unknown-username response differs from the success path despite the enumeration warning. The five-second metric includes a user-controlled biometric prompt, and the repository targets Next.js 16 while showing middleware conventions that need version confirmation. | Agree on enumeration/rate-limit ownership and generic responses; measure server latency separately from user interaction. Validate the route-protection convention against the selected Next.js version/runtime without importing SQLite into an incompatible runtime. |

### Acceptance and Test Additions Proposed

- [ ] Registration, login, and additional-passkey enrollment have separate, explicit authorization and account-binding contracts.
- [ ] Reject expired, replayed, missing, wrong-browser, wrong-operation, and cross-account challenges; parallel attempts have deterministic outcomes.
- [ ] Reject wrong RP ID, wrong origin, invalid signatures, and missing required user verification before any session or counter update.
- [ ] Registration failure rolls back both rows; concurrent registrations produce one account/credential and a controlled conflict response.
- [ ] Preserve the existing zero-counter compatibility tests; add successful counter update and concurrent/stale assertion rejection tests using the selected library's behavior.
- [ ] Verify cookie HttpOnly, SameSite, production Secure, path, expiry, and deletion attributes; reject malformed claims, tampered signatures, and expired JWTs.
- [ ] Prove unauthenticated API requests return JSON 401, while protected pages redirect. Test cross-user resource access with two independent authenticated contexts.
- [ ] Enroll a second virtual authenticator only after authenticating the account; verify either passkey works and anonymous enrollment fails.
- [ ] Cancellation, unavailable WebAuthn, network failure, and duplicate clicks leave a retryable login UI without losing the username.
- [ ] Each dependent suite creates or loads its own valid authenticated state without relying on authentication test-file execution order.

### Questions and Cross-PRP Handoffs

- **Persons 1-4 (PRPs 01-10):** Agree on `getSession(): Promise<Session | null>` and session-derived ownership before implementing protected routes. Each resource query must check ownership, including child/association operations; page redirects are not API authorization.
- **Person 1 (PRP 10):** Confirm `/calendar` uses the same session contract and unauthenticated redirect behavior as `/`.
- **All test owners:** Use shared authentication fixtures and separate user contexts for isolation; virtual authenticator setup must be available per relevant browser context.
- **Team/security/deployment owner:** Confirm library versions, RP ID/origin per environment, JWT secret provisioning, challenge storage, rate limiting, and whether logout requires revocation. These remain decisions, not implemented guarantees.
- **Stakeholder decision:** Account recovery is explicitly excluded. Document the lockout risk before release and distinguish authenticated additional-passkey enrollment from recovery after all passkeys are lost.
