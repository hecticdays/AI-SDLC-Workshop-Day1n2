'use client';

export async function authPost<ResponseBody>(path: string, body: unknown = {}): Promise<ResponseBody> {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Authentication failed');
  return result as ResponseBody;
}

export function authMessage(error: unknown) {
  if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
    return 'Passkey request cancelled or timed out. You can try again.';
  }
  return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
}