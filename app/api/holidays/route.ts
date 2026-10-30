import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { findHolidays } from '@/lib/db';
import { getCalendarGridDateRange } from '@/lib/calendar';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const yearValue = searchParams.get('year');
  const monthValue = searchParams.get('month');
  if ((yearValue === null) !== (monthValue === null)) {
    return NextResponse.json({ error: 'Both year and month are required together.' }, { status: 400 });
  }
  if (yearValue === null || monthValue === null) return NextResponse.json({ holidays: findHolidays() });

  const year = Number(yearValue);
  const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid year or month.' }, { status: 400 });
  }
  const { startDate, endDateExclusive } = getCalendarGridDateRange(year, month);
  return NextResponse.json({ holidays: findHolidays(startDate, endDateExclusive) });
}