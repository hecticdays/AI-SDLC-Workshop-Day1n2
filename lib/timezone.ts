import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const SINGAPORE_TIMEZONE = 'Asia/Singapore';

export function getSingaporeNow(): Date {
  return new Date();
}

export function singaporeInstant(value: string): Date {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? new Date(value)
    : fromZonedTime(value.replace(' ', 'T'), SINGAPORE_TIMEZONE);
}

export function formatSingaporeDate(value: string | Date, pattern = 'yyyy-MM-dd'): string {
  const date = typeof value === 'string' ? singaporeInstant(value) : value;
  return formatInTimeZone(date, SINGAPORE_TIMEZONE, pattern);
}

export function formatSingaporeDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? singaporeInstant(value) : value;
  return formatInTimeZone(date, SINGAPORE_TIMEZONE, 'd MMM, HH:mm');
}