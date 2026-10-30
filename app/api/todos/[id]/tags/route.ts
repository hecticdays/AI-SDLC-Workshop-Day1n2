import { NextResponse } from 'next/server';
import { z } from 'zod';
import { tagDB } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };
const associationSchema = z.object({ tag_id: z.number().int().positive() }).strict();

async function change(request: Request, { params }: Context, attach: boolean) {
  try {
    const session = await requireSession(request);
    const todoId = parseId((await params).id);
    const body = associationSchema.parse(await readBody(request));
    if (attach) tagDB.attachToTodo(todoId, body.tag_id, session.userId);
    else tagDB.detachFromTodo(todoId, body.tag_id, session.userId);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Context) { return change(request, context, true); }
export async function DELETE(request: Request, context: Context) { return change(request, context, false); }