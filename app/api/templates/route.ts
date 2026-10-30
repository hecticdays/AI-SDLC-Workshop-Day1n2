import { NextResponse } from 'next/server';
import { templateDB, templateInputSchema } from '@/lib/db';
import { apiError, readBody, requireSession } from '@/lib/api';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return NextResponse.json(templateDB.findAllByUser(session.userId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    return NextResponse.json(templateDB.create(session.userId, templateInputSchema.parse(await readBody(request))), { status: 201 });
  } catch (error) { return apiError(error); }
}