import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateCalendarGrid, getCalendarGridDateRange, monthLabel, parseMonthParam, shiftMonth, todosForSingaporeDate,
} from '@/lib/calendar';
import { sectionTodos, sortTodos } from '@/lib/todo-sort';
import { isDueDateAtLeastOneMinuteAhead } from '@/lib/validation';
import { todoInputSchema, todoUpdateSchema, type Todo } from '@/lib/db';

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

  it('emits 42 cells for short, long and differently aligned months', () => {
    for (const [year, month, currentMonthDays] of [[2026, 2, 28], [2026, 3, 31], [2026, 11, 30]] as const) {
      const grid = generateCalendarGrid(year, month, '2026-01-01');
      assert.equal(grid.length, 42);
      assert.equal(grid.filter((day) => day.isCurrentMonth).length, currentMonthDays);
      assert.equal(grid.filter((day) => day.isToday).length, 0);
    }
  });

  it('flags weekends only on Sunday and Saturday columns', () => {
    const grid = generateCalendarGrid(2026, 3, '2026-03-01');
    assert.deepEqual(grid.filter((_, index) => index % 7 === 0).every((day) => day.isWeekend), true);
    assert.deepEqual(grid.filter((_, index) => index % 7 === 6).every((day) => day.isWeekend), true);
    assert.equal(grid.filter((_, index) => index % 7 > 0 && index % 7 < 6).some((day) => day.isWeekend), false);
  });

  it('falls back to the current Singapore month for malformed, out-of-range or missing values', () => {
    assert.deepEqual(parseMonthParam('2028-02', '2026-10'), { year: 2028, month: 2 });
    for (const invalid of [undefined, null, '', 'abc', '2026-13', '2026-00', '0000-01', '10000-01']) {
      assert.deepEqual(parseMonthParam(invalid, '2026-10'), { year: 2026, month: 10 });
    }
  });

  it('shifts months across year boundaries and clamps to the supported range', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth({ year: 1, month: 1 }, -1), { year: 1, month: 1 });
    assert.deepEqual(shiftMonth({ year: 9999, month: 12 }, 1), { year: 9999, month: 12 });
  });

  it('labels years below 100 without the two-digit year shift', () => {
    assert.equal(monthLabel({ year: 2028, month: 2 }), 'February 2028');
    assert.equal(monthLabel({ year: 50, month: 3 }), 'March 50');
  });

  it('places an ISO UTC due date on the Singapore-local day', () => {
    const todo = makeTodo({ due_date: '2026-02-28T16:30:00.000Z' });
    assert.equal(todosForSingaporeDate([todo], '2026-03-01').length, 1);
    assert.equal(todosForSingaporeDate([makeTodo()], '2026-03-01').length, 0);
  });
});

describe('request validation', () => {
  it('defaults priority and optional metadata on create but rejects null priority', () => {
    assert.deepEqual(todoInputSchema.parse({ title: '  Ship it  ' }), {
      title: 'Ship it', priority: 'medium', tag_ids: [], is_recurring: false,
    });
    assert.equal(todoInputSchema.safeParse({ title: 'Task', priority: null }).success, false);
  });

  it('accepts sparse updates and rejects empty updates or invalid priority', () => {
    assert.equal(todoUpdateSchema.safeParse({ completed: true }).success, true);
    assert.equal(todoUpdateSchema.safeParse({}).success, false);
    assert.equal(todoUpdateSchema.safeParse({ priority: 'urgent' }).success, false);
  });

  it('normalizes accepted due dates to UTC so stored values sort chronologically', () => {
    const earlier = todoInputSchema.parse({ title: 'Earlier', due_date: '2030-01-02T10:00:00+09:00' }).due_date;
    const later = todoInputSchema.parse({ title: 'Later', due_date: '2030-01-02T02:00:00Z' }).due_date;
    assert.equal(earlier, '2030-01-02T01:00:00.000Z');
    assert.equal(later, '2030-01-02T02:00:00.000Z');
    assert.ok(earlier! < later!, 'string ordering must match chronological ordering');
    assert.equal(todoUpdateSchema.parse({ due_date: '2028-03-01T00:30:00+08:00' }).due_date, '2028-02-29T16:30:00.000Z');
  });

  it('requires a valid due date at least one minute ahead', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    assert.equal(isDueDateAtLeastOneMinuteAhead('2026-01-01T00:01:00.000Z', now), true);
    assert.equal(isDueDateAtLeastOneMinuteAhead('not-a-date', now), false);
    assert.equal(isDueDateAtLeastOneMinuteAhead('2025-12-31T23:59:00.000Z', now), false);
  });
});