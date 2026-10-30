import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from './auth';
import { DataError } from './db';

export async function requireSession(request: Request) {
  const session = await getSession();
  if (!session) throw new DataError('Not authenticated', 401);
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);
    const expectedOrigin = process.env.APP_ORIGIN ?? `${url.protocol}//${request.headers.get('host') ?? url.host}`;
    if (origin && origin !== expectedOrigin) throw new DataError('Invalid request origin', 403);
  }
  return session;
}

export async function readBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new DataError('Invalid JSON format', 400); }
}

export function parseId(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new DataError('Invalid ID', 400);
  return Number(value);
}

export function apiError(error: unknown) {
  if (error instanceof DataError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  console.error('API request failed', error);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}