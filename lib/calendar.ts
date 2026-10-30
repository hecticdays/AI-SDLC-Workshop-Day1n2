import type { Todo } from '@/lib/db';
import { formatSingaporeDate } from '@/lib/timezone';

export interface CalendarDay {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

export function generateCalendarGrid(year: number, month: number, today = formatSingaporeDate(new Date(), 'yyyy-MM-dd')): CalendarDay[] {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Calendar year and month are invalid');
  }

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const leadingDays = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - leadingDays + 1;
    const date = new Date(Date.UTC(year, month - 1, dayOffset));
    const dateString = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();

    return {
      date: dateString,
      isCurrentMonth: dayOffset >= 1 && dayOffset <= daysInMonth,
      isToday: dateString === today,
      isPast: dateString < today,
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

export function getCalendarGridDateRange(year: number, month: number) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstVisible = new Date(Date.UTC(year, month - 1, 1 - firstOfMonth.getUTCDay()));
  const endExclusive = new Date(firstVisible);
  endExclusive.setUTCDate(firstVisible.getUTCDate() + 42);
  return {
    startDate: firstVisible.toISOString().slice(0, 10),
    endDateExclusive: endExclusive.toISOString().slice(0, 10),
  };
}

export function todosForSingaporeDate(todos: Todo[], date: string): Todo[] {
  return todos.filter((todo) => todo.due_date !== null
    && formatSingaporeDate(new Date(todo.due_date), 'yyyy-MM-dd') === date);
}