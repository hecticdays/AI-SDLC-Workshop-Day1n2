import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/session-token';

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === 'development' && process.env.DEMO_MODE === 'true'
    && process.env.DATABASE_PATH === 'demo.db') return NextResponse.next();
  const token = request.cookies.get('session')?.value;
  if (token && await verifySessionToken(token)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/', '/calendar/:path*', '/api/todos/:path*', '/api/holidays/:path*'],
};