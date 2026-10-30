import { NextResponse } from 'next/server';
import { DataError, todoDB, todoInputSchema } from '@/lib/db';
import { apiError, readBody, requireSession } from '@/lib/api';
import { isDueDateAtLeastOneMinuteAhead } from '@/lib/validation';

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return NextResponse.json(todoDB.findAllByUser(session.userId));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const input = todoInputSchema.parse(await readBody(request));
    if (!isDueDateAtLeastOneMinuteAhead(input.due_date)) {
      throw new DataError('Due date must be valid and at least 1 minute in the future.', 400);
    }
    if (input.is_recurring && !input.due_date) {
      throw new DataError('Recurring todos require a due date.', 400);
    }
    return NextResponse.json(todoDB.create(session.userId, input), { status: 201 });
  } catch (error) { return apiError(error); }
}