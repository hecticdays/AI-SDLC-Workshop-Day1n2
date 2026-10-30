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

export const MIN_CALENDAR_YEAR = 1;
export const MAX_CALENDAR_YEAR = 9999;

export interface CalendarMonth {
  year: number;
  month: number;
}

/** Falls back to the current Singapore month for malformed or out-of-range values. */
export function parseMonthParam(value: string | undefined | null, today = formatSingaporeDate(new Date(), 'yyyy-MM')): CalendarMonth {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (year >= MIN_CALENDAR_YEAR && year <= MAX_CALENDAR_YEAR && month >= 1 && month <= 12) return { year, month };
  }
  const [year, month] = today.split('-').map(Number);
  return { year, month };
}

/** Months are 1-indexed; the result is clamped to the supported calendar range. */
export function shiftMonth({ year, month }: CalendarMonth, offset: number): CalendarMonth {
  const absolute = year * 12 + (month - 1) + offset;
  const shiftedYear = Math.floor(absolute / 12);
  if (shiftedYear < MIN_CALENDAR_YEAR) return { year: MIN_CALENDAR_YEAR, month: 1 };
  if (shiftedYear > MAX_CALENDAR_YEAR) return { year: MAX_CALENDAR_YEAR, month: 12 };
  return { year: shiftedYear, month: (absolute % 12) + 1 };
}

/** Date.UTC maps years 0-99 to 1900-1999, so the year is assigned explicitly. */
export function monthLabel({ year, month }: CalendarMonth): string {
  const date = new Date(Date.UTC(2000, month - 1, 15));
  date.setUTCFullYear(year);
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(date);
}

export function todosForSingaporeDate(todos: Todo[], date: string): Todo[] {
  return todos.filter((todo) => todo.due_date !== null
    && formatSingaporeDate(new Date(todo.due_date), 'yyyy-MM-dd') === date);
}