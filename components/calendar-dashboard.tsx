'use client';

import { ArrowLeft, ArrowRight, CalendarDays, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Holiday, Todo } from '@/lib/db';
import { generateCalendarGrid, todosForSingaporeDate } from '@/lib/calendar';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

type CalendarDashboardProps = { initialMonth: { year: number; month: number } };

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'The request could not be completed.';
}

export function CalendarDashboard({ initialMonth }: CalendarDashboardProps) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const today = formatSingaporeDate(getSingaporeNow(), 'yyyy-MM-dd');
  const days = useMemo(() => generateCalendarGrid(month.year, month.month, today), [month.year, month.month, today]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [todoResponse, holidayResponse] = await Promise.all([
          fetch('/api/todos', { signal: controller.signal }),
          fetch(`/api/holidays?year=${month.year}&month=${month.month}`, { signal: controller.signal }),
        ]);
        if (!todoResponse.ok) throw new Error(await responseError(todoResponse));
        if (!holidayResponse.ok) throw new Error(await responseError(holidayResponse));
        const [todoData, holidayData] = await Promise.all([todoResponse.json(), holidayResponse.json()]);
        if (!Array.isArray(todoData) || !Array.isArray(holidayData.holidays)) throw new Error('Invalid calendar response.');
        setTodos(todoData);
        setHolidays(holidayData.holidays);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not load calendar data.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [month.year, month.month, retry]);

  function navigateMonth(offset: number) {
    const next = new Date(Date.UTC(month.year, month.month - 1 + offset, 1));
    const nextMonth = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
    setMonth(nextMonth);
    router.replace(`/calendar?month=${nextMonth.year}-${String(nextMonth.month).padStart(2, '0')}`);
    setSelectedDate(null);
  }

  function goToToday() {
    const [year, monthValue] = today.split('-').map(Number);
    setMonth({ year, month: monthValue });
    router.replace(`/calendar?month=${year}-${String(monthValue).padStart(2, '0')}`);
    setSelectedDate(null);
  }

  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  const selectedTodos = selectedDate ? todosForSingaporeDate(todos, selectedDate) : [];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <main className="app-shell calendar-shell">
      <header className="topbar">
        <Link className="brand-lockup" href="/"><span className="brand-mark"><Check size={18} aria-hidden="true" /></span><span>DAYMARK</span></Link>
        <nav className="top-nav" aria-label="Main navigation"><Link className="nav-link" href="/">Tasks</Link><Link className="nav-link active" href="/calendar"><CalendarDays size={16} aria-hidden="true" /> Calendar</Link></nav>
        <button className="icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}>↗</button>
      </header>

      <section className="page-heading calendar-heading">
        <div><p className="eyebrow">PLAN AHEAD · SINGAPORE</p><h1>Your month, in view.</h1><p className="muted-copy">Tasks and public holidays, on the same page.</p></div>
        <div className="month-controls">
          <button className="secondary-button icon-text-button" onClick={() => navigateMonth(-1)} aria-label="Previous month"><ArrowLeft size={16} />Previous</button>
          <button className="secondary-button" onClick={goToToday}>Today</button>
          <button className="secondary-button icon-text-button" onClick={() => navigateMonth(1)} aria-label="Next month">Next<ArrowRight size={16} /></button>
        </div>
      </section>

      <section className="calendar-panel" aria-label="Calendar">
        <div className="calendar-panel-heading"><h2>{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(month.year, month.month - 1, 15)))}</h2><span className="timezone-label">UTC+8</span></div>
        <div className="calendar-grid" role="grid" aria-label="Monthly calendar">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}
          {days.map((day) => {
            const dayTodos = todosForSingaporeDate(todos, day.date);
            const holiday = holidayByDate.get(day.date);
            return (
              <button
                className={`calendar-cell ${day.isCurrentMonth ? '' : 'outside-month'} ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''} ${day.isWeekend ? 'is-weekend' : ''}`}
                role="gridcell"
                key={day.date}
                aria-label={`${day.date}${holiday ? `, ${holiday.name}` : ''}, ${dayTodos.length} tasks`}
                onClick={() => setSelectedDate(day.date)}
              >
                <span className="calendar-day-header">
                  <span className="calendar-day-number">{Number(day.date.slice(-2))}</span>
                  {dayTodos.length > 0 && <span className="calendar-count" aria-hidden="true">{dayTodos.length}</span>}
                </span>
                {holiday && <span className="holiday-name" title={holiday.name}>{holiday.name}</span>}
                {dayTodos.slice(0, 3).map((todo) => <span className={`calendar-todo priority-${todo.priority}`} key={todo.id}>{todo.title}</span>)}
                {dayTodos.length > 3 && <span className="calendar-overflow">+{dayTodos.length - 3} more</span>}
              </button>
            );
          })}
        </div>
        {loading && <p className="calendar-status" role="status">Loading month…</p>}
        {error && <div className="calendar-error" role="alert"><span>{error}</span><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <div className="calendar-legend"><span><i className="legend-dot priority-high" />High</span><span><i className="legend-dot priority-medium" />Medium</span><span><i className="legend-dot priority-low" />Low</span><span><i className="legend-dot holiday-dot" />Public holiday</span></div>
      </section>

      {selectedDate && (
        <dialog open className="dialog-backdrop" aria-labelledby="day-dialog-title" onCancel={(event) => { event.preventDefault(); setSelectedDate(null); }}>
          <section className="dialog-panel day-dialog">
            <div className="panel-heading"><div><p className="eyebrow">DAY DETAILS</p><h2 id="day-dialog-title">{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'full' }).format(new Date(`${selectedDate}T12:00:00+08:00`))}</h2></div><button className="icon-button" aria-label="Close day details" onClick={() => setSelectedDate(null)}>×</button></div>
            {holidayByDate.get(selectedDate) && <p className="day-holiday">{holidayByDate.get(selectedDate)?.name}</p>}
            {selectedTodos.length === 0 ? <p className="section-empty">No tasks due on this day.</p> : <ul className="day-todo-list">{selectedTodos.map((todo) => <li key={todo.id}><span className={`priority-badge priority-${todo.priority}`}>{todo.priority}</span><span className={todo.completed ? 'completed-title' : ''}>{todo.title}</span><span>{todo.completed ? 'Completed' : 'Open'}</span></li>)}</ul>}
          </section>
        </dialog>
      )}
      <footer className="app-footer"><span>DAYMARK / SINGAPORE</span><span>One month at a time</span></footer>
    </main>
  );
}