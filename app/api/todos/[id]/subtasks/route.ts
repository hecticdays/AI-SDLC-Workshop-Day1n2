import { NextResponse } from 'next/server';
import { subtaskDB, subtaskInputSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    return NextResponse.json(subtaskDB.findByTodoId(parseId(id), session.userId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const session = await requireSession(request);
    const { id } = await params;
    return NextResponse.json(subtaskDB.create(parseId(id), session.userId, subtaskInputSchema.parse(await readBody(request))), { status: 201 });
  } catch (error) { return apiError(error); }
}