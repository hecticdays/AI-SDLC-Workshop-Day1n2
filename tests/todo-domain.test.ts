import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    assert.deepEqual(sorted.map((todo) => todo.id), [3, 2, 1]);
    assert.deepEqual(todos.map((todo) => todo.id), [1, 2, 3]);
  });

  it('buckets at the due-time boundary and sorts completed items by priority', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const result = sectionTodos([
      makeTodo({ id: 1, due_date: '2026-05-31T23:59:59Z' }),
      makeTodo({ id: 2, due_date: '2026-06-01T00:00:00Z' }),
      makeTodo({ id: 3, completed: true, priority: 'low' }),
      makeTodo({ id: 4, completed: true, priority: 'high' }),
    ], now);
    assert.deepEqual(result.overdue.map((todo) => todo.id), [1]);
    assert.deepEqual(result.pending.map((todo) => todo.id), [2]);
    assert.deepEqual(result.completed.map((todo) => todo.id), [4, 3]);
  });
});

describe('calendar domain', () => {
  it('always returns 42 cells and includes leap day', () => {
    const grid = generateCalendarGrid(2028, 2, '2028-02-29');
    assert.equal(grid.length, 42);
    assert.equal(grid.filter((day) => day.isCurrentMonth).length, 29);
    assert.equal(grid.filter((day) => day.isToday).length, 1);
    assert.equal(grid.find((day) => day.date === '2028-02-29')?.isCurrentMonth, true);
  });

  it('covers exactly 42 visible dates including adjacent months', () => {
    const range = getCalendarGridDateRange(2026, 3);
    assert.equal(range.startDate, '2026-03-01');
    assert.equal(range.endDateExclusive, '2026-04-12');
  });

  it('places an ISO UTC due date on the Singapore-local day', () => {
    const todo = makeTodo({ due_date: '2026-02-28T16:30:00.000Z' });
    assert.equal(todosForSingaporeDate([todo], '2026-03-01').length, 1);
    assert.equal(todosForSingaporeDate([makeTodo()], '2026-03-01').length, 0);
  });
});

describe('request validation', () => {
  it('defaults priority and optional metadata on create but rejects null priority', () => {
    assert.deepEqual(todoCreateSchema.parse({ title: '  Ship it  ' }), {
      title: 'Ship it', priority: 'medium', tag_ids: [], is_recurring: false,
    });
    assert.equal(todoCreateSchema.safeParse({ title: 'Task', priority: null }).success, false);
  });

  it('accepts sparse updates and rejects empty updates or invalid priority', () => {
    assert.equal(todoUpdateSchema.safeParse({ completed: true }).success, true);
    assert.equal(todoUpdateSchema.safeParse({}).success, false);
    assert.equal(todoUpdateSchema.safeParse({ priority: 'urgent' }).success, false);
  });

  it('requires a valid due date at least one minute ahead', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    assert.equal(isDueDateAtLeastOneMinuteAhead('2026-01-01T00:01:00.000Z', now), true);
    assert.equal(isDueDateAtLeastOneMinuteAhead('not-a-date', now), false);
    assert.equal(isDueDateAtLeastOneMinuteAhead('2025-12-31T23:59:00.000Z', now), false);
  });
});