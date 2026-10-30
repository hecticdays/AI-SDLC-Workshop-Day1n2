import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { parseMonthParam } from '@/lib/calendar';
import { CalendarDashboard } from '@/components/calendar-dashboard';

type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  if (!(await getSession())) redirect('/login');
  const { month } = await searchParams;
  return <CalendarDashboard initialMonth={parseMonthParam(month)} />;
}