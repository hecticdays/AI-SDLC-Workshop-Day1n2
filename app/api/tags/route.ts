import { NextResponse } from 'next/server';
import { tagDB, tagInputSchema } from '@/lib/db';
import { apiError, readBody, requireSession } from '@/lib/api';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return NextResponse.json(tagDB.findAllByUser(session.userId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = tagInputSchema.parse(await readBody(request));
    return NextResponse.json(tagDB.create(session.userId, body), { status: 201 });
  } catch (error) { return apiError(error); }
}