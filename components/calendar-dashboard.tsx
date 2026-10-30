'use client';

import { ArrowLeft, ArrowRight, CalendarDays, Layers3, ListTodo, LogOut, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  generateCalendarGrid, monthLabel, parseMonthParam, shiftMonth, todosForSingaporeDate, type CalendarMonth,
} from '@/lib/calendar';
import type { Holiday, Todo } from '@/lib/db';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_TODOS = 3;

type CalendarDashboardProps = { initialMonth: CalendarMonth };

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'The request could not be completed.';
}

function DayModal({ date, todos, holiday, onClose }: {
  date: string; todos: Todo[]; holiday: Holiday | undefined; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);

  return <dialog ref={dialog} className="modal" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-content">
      <header className="modal-header">
        <h2 id={titleId}>{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'full' }).format(new Date(`${date}T12:00:00+08:00`))}</h2>
        <button type="button" className="icon-button" aria-label="Close day details" title="Close" onClick={onClose}><X size={20} /></button>
      </header>
      {holiday && <p className="day-holiday">{holiday.name}</p>}
      {todos.length === 0 ? <p className="muted">No tasks due on this day.</p> : <ul className="day-todo-list">
        {todos.map((todo) => <li key={todo.id}>
          <span className={`priority ${todo.priority}`}><span />{todo.priority}</span>
          <span className={todo.completed ? 'completed-title' : undefined}>{todo.title}</span>
          <span>{todo.completed ? 'Completed' : 'Open'}</span>
        </li>)}
      </ul>}
    </div>
  </dialog>;
}

export function CalendarDashboard({ initialMonth }: CalendarDashboardProps) {
  const router = useRouter();
  const [month, setMonth] = useState<CalendarMonth>(initialMonth);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const today = formatSingaporeDate(getSingaporeNow(), 'yyyy-MM-dd');
  const days = useMemo(() => generateCalendarGrid(month.year, month.month, today), [month, today]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [todoResponse, holidayResponse] = await Promise.all([
          fetch('/api/todos', { signal: controller.signal, cache: 'no-store' }),
          fetch(`/api/holidays?year=${month.year}&month=${month.month}`, { signal: controller.signal, cache: 'no-store' }),
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
  }, [month, retry]);

  function goToMonth(next: CalendarMonth) {
    setMonth(next);
    setSelectedDate(null);
    router.replace(`/calendar?month=${next.year}-${String(next.month).padStart(2, '0')}`);
  }

  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  const selectedTodos = selectedDate ? todosForSingaporeDate(todos, selectedDate) : [];

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return <div className="app-shell">
    <header className="app-header">
      <Link href="/" className="brand"><span className="brand-icon"><Layers3 size={22} /></span>Daybook<span className="brand-label">CALENDAR</span></Link>
      <div className="header-right">
        <span className="header-date">Asia/Singapore</span>
        <Link className="button secondary" href="/"><ListTodo size={16} />Tasks</Link>
        <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={17} /></button>
      </div>
    </header>

    <main>
      <div className="page-heading">
        <div><p className="eyebrow">PLAN AHEAD</p><h1>Your month, in view<span className="heading-dot">.</span></h1></div>
        <div className="month-controls">
          <button className="button secondary" aria-label="Previous month" onClick={() => goToMonth(shiftMonth(month, -1))}><ArrowLeft size={15} />Prev</button>
          <button className="button secondary" onClick={() => goToMonth(parseMonthParam(undefined, today.slice(0, 7)))}>Today</button>
          <button className="button secondary" aria-label="Next month" onClick={() => goToMonth(shiftMonth(month, 1))}>Next<ArrowRight size={15} /></button>
        </div>
      </div>

      {error && <div role="alert" className="error-banner"><span>{error}</span>
        <button className="button secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button>
      </div>}

      <section className="calendar-panel" aria-label="Calendar">
        <div className="calendar-panel-heading">
          <h2><CalendarDays size={16} />{monthLabel(month)}</h2>
          <span className="timezone-label">UTC+8</span>
          {loading && <span className="muted" role="status">Loading month…</span>}
        </div>
        <div className="calendar-grid" role="grid" aria-label="Monthly calendar">
          {WEEKDAYS.map((day) => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}
          {days.map((day) => {
            const dayTodos = todosForSingaporeDate(todos, day.date);
            const holiday = holidayByDate.get(day.date);
            const overflow = dayTodos.length - MAX_VISIBLE_TODOS;
            return <button
              type="button"
              role="gridcell"
              key={day.date}
              className={`calendar-cell${day.isCurrentMonth ? '' : ' outside-month'}${day.isToday ? ' is-today' : ''}${day.isPast ? ' is-past' : ''}${day.isWeekend ? ' is-weekend' : ''}`}
              aria-label={`${day.date}${holiday ? `, ${holiday.name}` : ''}, ${dayTodos.length} tasks`}
              onClick={() => setSelectedDate(day.date)}
            >
              <span className="calendar-day-header">
                <span className="calendar-day-number">{Number(day.date.slice(-2))}</span>
                {dayTodos.length > 0 && <span className="calendar-count" aria-hidden="true">{dayTodos.length}</span>}
              </span>
              {holiday && <span className="holiday-name" title={holiday.name}>{holiday.name}</span>}
              {dayTodos.slice(0, MAX_VISIBLE_TODOS).map((todo) => (
                <span className={`calendar-todo ${todo.priority}`} key={todo.id} title={todo.title}>{todo.title}</span>
              ))}
              {overflow > 0 && <span className="calendar-overflow">+{overflow} more</span>}
            </button>;
          })}
        </div>
        <div className="calendar-legend">
          <span><i className="legend-dot high" />High</span>
          <span><i className="legend-dot medium" />Medium</span>
          <span><i className="legend-dot low" />Low</span>
          <span><i className="legend-dot holiday" />Public holiday</span>
        </div>
      </section>

      <footer className="workspace-footer"><span><span className="status-dot" />Due-dated tasks only</span><span>Singapore time (SGT)</span></footer>
    </main>

    {selectedDate && <DayModal date={selectedDate} todos={selectedTodos}
      holiday={holidayByDate.get(selectedDate)} onClose={() => setSelectedDate(null)} />}
  </div>;
}
