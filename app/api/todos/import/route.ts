import { NextResponse } from 'next/server';
import { apiError, readBody, requireSession } from '@/lib/api';
import { DataError, getDatabase } from '@/lib/db';
import { createPortability, importSchema } from '@/lib/portability';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const parsed = importSchema.safeParse(await readBody(request));
    if (!parsed.success) throw new DataError('Failed to import todos. Please check the file format.', 400);
    const result = createPortability(getDatabase()).importAll(session.userId, parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) { return apiError(error); }
}