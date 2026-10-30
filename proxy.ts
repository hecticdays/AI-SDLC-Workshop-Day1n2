import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from './lib/auth-token';

export async function proxy(request: NextRequest) {
  const demo = process.env.NODE_ENV === 'development' && process.env.DEMO_MODE === 'true' && process.env.DATABASE_PATH === 'demo.db';
  const token = request.cookies.get('session')?.value;
  if (demo || (token && await verifySessionToken(token))) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = { matcher: ['/', '/calendar/:path*'] };