import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { formatSingaporeDate } from '@/lib/timezone';
import { CalendarDashboard } from '@/components/calendar-dashboard';

type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

function parseMonth(value: string | undefined) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split('-').map(Number);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const [year, month] = formatSingaporeDate(new Date(), 'YYYY-MM').split('-').map(Number);
  return { year, month };
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  if (!(await getSession())) redirect('/login');
  const { month } = await searchParams;
  const initialMonth = parseMonth(month);
  return <CalendarDashboard initialMonth={initialMonth} />;
}