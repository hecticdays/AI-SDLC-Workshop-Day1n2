import { authEndpoint } from '@/lib/webauthn';
export const runtime = 'nodejs';
export async function POST(request: Request) { return authEndpoint(request, 'register', 'options'); }
