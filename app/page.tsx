import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { TodoDashboard } from '@/components/todo-dashboard';

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  return <TodoDashboard />;
}