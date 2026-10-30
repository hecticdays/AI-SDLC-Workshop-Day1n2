import { NextResponse } from 'next/server';
import { tagDB, tagUpdateSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const id = parseId((await params).id);
    const body = tagUpdateSchema.parse(await readBody(request));
    return NextResponse.json(tagDB.update(id, session.userId, body));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    tagDB.delete(parseId((await params).id), session.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}