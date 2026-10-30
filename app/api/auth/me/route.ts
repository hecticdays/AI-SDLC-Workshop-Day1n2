import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { demoEnabled } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  return session ? NextResponse.json({ ...session, demo: demoEnabled() })
    : NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}