import { NextResponse } from 'next/server';
import { subtaskDB, subtaskUpdateSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    return NextResponse.json(subtaskDB.update(parseId(id), session.userId, subtaskUpdateSchema.parse(await readBody(request))));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    subtaskDB.delete(parseId(id), session.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}