import { NextResponse } from 'next/server';
import { DataError, todoDB, todoUpdateSchema } from '@/lib/db';
import { apiError, parseId, readBody, requireSession } from '@/lib/api';
import { isDueDateAtLeastOneMinuteAhead } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = parseId((await context.params).id);
    const todo = todoDB.findById(id, session.userId);
    if (!todo) throw new DataError('Todo not found', 404);
    return NextResponse.json(todo);
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = parseId((await context.params).id);
    const existing = todoDB.findById(id, session.userId);
    if (!existing) throw new DataError('Todo not found', 404);
    const parsed = todoUpdateSchema.parse(await readBody(request));
    if (Object.hasOwn(parsed, 'due_date') && !isDueDateAtLeastOneMinuteAhead(parsed.due_date)) {
      throw new DataError('Due date must be valid and at least 1 minute in the future.', 400);
    }
    const nextDueDate = Object.hasOwn(parsed, 'due_date') ? parsed.due_date : existing.due_date;
    if (parsed.is_recurring === true && !nextDueDate) throw new DataError('Recurring todos require a due date.', 400);
    const updated = todoDB.update(id, session.userId, parsed);
    if (!updated) throw new DataError('Todo not found', 404);
    return NextResponse.json(updated);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const session = await requireSession(request);
    const id = parseId((await context.params).id);
    if (!todoDB.delete(id, session.userId)) throw new DataError('Todo not found', 404);
    return NextResponse.json({ success: true });
  } catch (error) { return apiError(error); }
}