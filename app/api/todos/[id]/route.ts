import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteTodo, findTodo, updateTodo } from '@/lib/db';
import { isDueDateAtLeastOneMinuteAhead, todoUpdateSchema } from '@/lib/validation';

type Context = { params: Promise<{ id: string }> };

async function getOwnedTodo(request: Request, context: Context) {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return { response: NextResponse.json({ error: 'Todo not found' }, { status: 404 }) };
  const todo = findTodo(session.userId, Number(id));
  if (!todo) return { response: NextResponse.json({ error: 'Todo not found' }, { status: 404 }) };
  return { session, todo, id: Number(id) };
}

export async function GET(request: Request, context: Context) {
  const owned = await getOwnedTodo(request, context);
  if ('response' in owned) return owned.response;
  return NextResponse.json(owned.todo);
}

export async function PUT(request: Request, context: Context) {
  const owned = await getOwnedTodo(request, context);
  if ('response' in owned) return owned.response;
  const parsed = todoUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid todo update.' }, { status: 400 });
  if (Object.hasOwn(parsed.data, 'due_date') && !isDueDateAtLeastOneMinuteAhead(parsed.data.due_date)) {
    return NextResponse.json({ error: 'Due date must be valid and at least 1 minute in the future.' }, { status: 400 });
  }
  const todo = updateTodo(owned.session.userId, owned.id, parsed.data);
  return todo ? NextResponse.json(todo) : NextResponse.json({ error: 'Todo not found' }, { status: 404 });
}

export async function DELETE(request: Request, context: Context) {
  const owned = await getOwnedTodo(request, context);
  if ('response' in owned) return owned.response;
  const deleted = deleteTodo(owned.session.userId, owned.id);
  return deleted
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: 'Todo not found' }, { status: 404 });
}