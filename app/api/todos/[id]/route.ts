import { NextResponse } from 'next/server';
import { DataError, todoDB, todoUpdateSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    const todo = todoDB.findById(parseId(id), session.userId);
    if (!todo) throw new DataError('Todo not found', 404);
    return NextResponse.json(todo);
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    return NextResponse.json(todoDB.update(parseId(id), session.userId, todoUpdateSchema.parse(await readBody(request))));
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    todoDB.delete(parseId(id), session.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}