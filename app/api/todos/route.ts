import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { insertTodo, InvalidTodoTagsError, listTodos } from '@/lib/db';
import { isDueDateAtLeastOneMinuteAhead, todoCreateSchema } from '@/lib/validation';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return NextResponse.json({ todos: listTodos(session.userId) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const parsed = todoCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo.' }, { status: 400 });
  if (!isDueDateAtLeastOneMinuteAhead(parsed.data.due_date)) {
    return NextResponse.json({ error: 'Due date must be valid and at least 1 minute in the future.' }, { status: 400 });
  }
  try {
    return NextResponse.json(insertTodo(session.userId, parsed.data), { status: 201 });
  } catch (error) {
    if (error instanceof InvalidTodoTagsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}