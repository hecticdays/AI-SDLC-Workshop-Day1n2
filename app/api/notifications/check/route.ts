import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    // Claiming during the check keeps multiple tabs from showing the same reminder.
    return NextResponse.json({ todos: todoDB.claimDueReminders(session.userId) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Reminder check failed:', error);
    return NextResponse.json({ error: 'Could not check reminders' }, { status: 500 });
  }
}
