import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/session-token';

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('todo_session')?.value;
  if (token && await verifySessionToken(token)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/', '/calendar/:path*', '/api/todos/:path*', '/api/holidays/:path*'],
};