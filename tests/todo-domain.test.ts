import { describe, expect, it } from 'vitest';
import { generateCalendarGrid, getCalendarGridDateRange, todosForSingaporeDate } from '@/lib/calendar';
import { sectionTodos, sortTodos } from '@/lib/todo-sort';
import { isDueDateAtLeastOneMinuteAhead, todoCreateSchema, todoUpdateSchema } from '@/lib/validation';
import type { Todo } from '@/lib/db';

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 1, user_id: 1, title: 'Task', completed: false, due_date: null, priority: 'medium',
    is_recurring: false, recurrence_pattern: null, reminder_minutes: null, last_notification_sent: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: null, subtasks: [], tags: [], ...overrides,
  };
}

describe('todo sorting and sections', () => {
  it('sorts priority, due date, then newest creation without mutating input', () => {
    const todos = [
      makeTodo({ id: 1, priority: 'low', due_date: null }),
      makeTodo({ id: 2, priority: 'high', due_date: '2026-02-02T00:00:00Z' }),
      makeTodo({ id: 3, priority: 'high', due_date: '2026-02-01T00:00:00Z' }),
    ];
    const sorted = sortTodos(todos);
    expect(sorted.map((todo) => todo.id)).toEqual([3, 2, 1]);
    expect(todos.map((todo) => todo.id)).toEqual([1, 2, 3]);
  });

  it('buckets at the due-time boundary and sorts completed items by priority', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const result = sectionTodos([
      makeTodo({ id: 1, due_date: '2026-05-31T23:59:59Z' }),
      makeTodo({ id: 2, due_date: '2026-06-01T00:00:00Z' }),
      makeTodo({ id: 3, completed: true, priority: 'low' }),
      makeTodo({ id: 4, completed: true, priority: 'high' }),
    ], now);
    expect(result.overdue.map((todo) => todo.id)).toEqual([1]);
    expect(result.pending.map((todo) => todo.id)).toEqual([2]);
    expect(result.completed.map((todo) => todo.id)).toEqual([4, 3]);
  });
});

describe('calendar domain', () => {
  it('always returns 42 cells and includes leap day', () => {
    const grid = generateCalendarGrid(2028, 2, '2028-02-29');
    expect(grid).toHaveLength(42);
    expect(grid.filter((day) => day.isCurrentMonth)).toHaveLength(29);
    expect(grid.filter((day) => day.isToday)).toHaveLength(1);
    expect(grid.find((day) => day.date === '2028-02-29')?.isCurrentMonth).toBe(true);
  });

  it('covers exactly 42 visible dates including adjacent months', () => {
    const range = getCalendarGridDateRange(2026, 3);
    expect(range.startDate).toBe('2026-03-01');
    expect(range.endDateExclusive).toBe('2026-04-12');
  });

  it('places an ISO UTC due date on the Singapore-local day', () => {
    const todo = makeTodo({ due_date: '2026-02-28T16:30:00.000Z' });
    expect(todosForSingaporeDate([todo], '2026-03-01')).toHaveLength(1);
    expect(todosForSingaporeDate([makeTodo()], '2026-03-01')).toHaveLength(0);
  });
});

describe('request validation', () => {
  it('defaults priority and optional metadata on create but rejects null priority', () => {
    expect(todoCreateSchema.parse({ title: '  Ship it  ' })).toMatchObject({ title: 'Ship it', priority: 'medium', tag_ids: [] });
    expect(todoCreateSchema.safeParse({ title: 'Task', priority: null }).success).toBe(false);
  });

  it('accepts sparse updates and rejects empty updates or invalid priority', () => {
    expect(todoUpdateSchema.safeParse({ completed: true }).success).toBe(true);
    expect(todoUpdateSchema.safeParse({}).success).toBe(false);
    expect(todoUpdateSchema.safeParse({ priority: 'urgent' }).success).toBe(false);
  });

  it('requires a valid due date at least one minute ahead', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isDueDateAtLeastOneMinuteAhead('2026-01-01T00:01:00.000Z', now)).toBe(true);
    expect(isDueDateAtLeastOneMinuteAhead('not-a-date', now)).toBe(false);
    expect(isDueDateAtLeastOneMinuteAhead('2025-12-31T23:59:00.000Z', now)).toBe(false);
  });
});