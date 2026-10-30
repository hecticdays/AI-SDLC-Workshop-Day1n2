'use client';

import { CalendarDays, Check, ChevronRight, Circle, LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Todo, TodoCreate, TodoUpdate } from '@/lib/db';
import { formatSingaporeDateTime } from '@/lib/timezone';
import { sectionTodos } from '@/lib/todo-sort';
import type { Priority } from '@/lib/todo-sort';

type TodoForm = {
  title: string;
  dueLocal: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: 'daily' | 'weekly' | 'monthly' | 'yearly';
  reminder_minutes: number | null;
};

const emptyForm: TodoForm = {
  title: '', dueLocal: '', priority: 'medium', is_recurring: false,
  recurrence_pattern: 'weekly', reminder_minutes: null,
};

function localInputFromSingaporeDate(value: string | null) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

function singaporeDateToISO(value: string) {
  if (!value) return null;
  return new Date(`${value}:00+08:00`).toISOString();
}

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : 'The request could not be completed.';
}

function TodoFields({ form, setForm }: { form: TodoForm; setForm: (next: TodoForm) => void }) {
  return (
    <>
      <label className="field-label" htmlFor="todo-title">Task</label>
      <input id="todo-title" className="text-input" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="What needs doing?" />
      {form.title.length > 200 && <p className="title-warning" role="status">Long titles can be harder to scan. This task will still be saved.</p>}
      <div className="form-grid">
        <div>
          <label className="field-label" htmlFor="todo-priority">Priority</label>
          <select id="todo-priority" className="text-input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
            <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="todo-due">Due date · Singapore time</label>
          <input id="todo-due" className="text-input" type="datetime-local" value={form.dueLocal} onChange={(event) => setForm({ ...form, dueLocal: event.target.value })} />
        </div>
      </div>
      <div className="form-grid metadata-row">
        <label className="check-label"><input type="checkbox" checked={form.is_recurring} onChange={(event) => setForm({ ...form, is_recurring: event.target.checked })} /> Repeat</label>
        {form.is_recurring && (
          <select aria-label="Recurrence pattern" className="text-input" value={form.recurrence_pattern} onChange={(event) => setForm({ ...form, recurrence_pattern: event.target.value as TodoForm['recurrence_pattern'] })}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
          </select>
        )}
        <label className="field-label reminder-field" htmlFor="todo-reminder">Reminder</label>
        <select id="todo-reminder" className="text-input" value={form.reminder_minutes ?? ''} disabled={!form.dueLocal} onChange={(event) => setForm({ ...form, reminder_minutes: event.target.value ? Number(event.target.value) : null })}>
          <option value="">None</option><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">1 week</option><option value="43200">1 month</option>
        </select>
      </div>
    </>
  );
}

export function TodoDashboard() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [form, setForm] = useState<TodoForm>(emptyForm);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [deleting, setDeleting] = useState<Todo | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/todos')
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<{ todos: Todo[] }>;
      })
      .then((data) => { if (active) setTodos(data.todos); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load todos.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => priorityFilter === 'all'
    ? todos
    : todos.filter((todo) => todo.priority === priorityFilter), [todos, priorityFilter]);
  const sections = useMemo(() => sectionTodos(filtered), [filtered]);

  async function saveNewTodo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    const input: TodoCreate = {
      title: form.title.trim(),
      due_date: singaporeDateToISO(form.dueLocal),
      priority: form.priority,
      is_recurring: form.is_recurring,
      recurrence_pattern: form.is_recurring ? form.recurrence_pattern : null,
      reminder_minutes: form.reminder_minutes,
      tag_ids: [],
    };
    const optimistic: Todo = {
      id: -Date.now(), user_id: 0, title: input.title, completed: false,
      due_date: input.due_date ?? null, priority: input.priority ?? 'medium',
      is_recurring: input.is_recurring ?? false, recurrence_pattern: input.recurrence_pattern ?? null,
      reminder_minutes: input.reminder_minutes ?? null, last_notification_sent: null,
      created_at: new Date().toISOString(), updated_at: null, subtasks: [], tags: [],
    };
    setTodos((current) => [...current, optimistic]);
    setForm(emptyForm);
    try {
      const response = await fetch('/api/todos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const saved = await response.json() as Todo;
      setTodos((current) => current.map((todo) => todo.id === optimistic.id ? saved : todo));
    } catch (caught) {
      setTodos((current) => current.filter((todo) => todo.id !== optimistic.id));
      setForm({ ...form, title: input.title });
      setError(caught instanceof Error ? caught.message : 'Could not create todo.');
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(todo: Todo) {
    setEditing(todo);
    setForm({
      title: todo.title, dueLocal: localInputFromSingaporeDate(todo.due_date), priority: todo.priority,
      is_recurring: todo.is_recurring, recurrence_pattern: todo.recurrence_pattern ?? 'weekly',
      reminder_minutes: todo.reminder_minutes,
    });
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    setSaving(true);
    const previous = editing;
    const update: TodoUpdate = {
      title: form.title.trim(), due_date: singaporeDateToISO(form.dueLocal), priority: form.priority,
      is_recurring: form.is_recurring, recurrence_pattern: form.is_recurring ? form.recurrence_pattern : null,
      reminder_minutes: form.reminder_minutes,
    };
    setTodos((current) => current.map((todo) => todo.id === previous.id ? { ...todo, ...update } : todo));
    setEditing(null);
    try {
      const response = await fetch(`/api/todos/${previous.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const saved = await response.json() as Todo;
      setTodos((current) => current.map((todo) => todo.id === saved.id ? saved : todo));
    } catch (caught) {
      setTodos((current) => current.map((todo) => todo.id === previous.id ? previous : todo));
      setError(caught instanceof Error ? caught.message : 'Could not update todo.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleTodo(todo: Todo) {
    const updated = { ...todo, completed: !todo.completed };
    setTodos((current) => current.map((item) => item.id === todo.id ? updated : item));
    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: updated.completed }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const saved = await response.json() as Todo;
      setTodos((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (caught) {
      setTodos((current) => current.map((item) => item.id === todo.id ? todo : item));
      setError(caught instanceof Error ? caught.message : 'Could not update todo.');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const removed = deleting;
    setTodos((current) => current.filter((todo) => todo.id !== removed.id));
    setDeleting(null);
    try {
      const response = await fetch(`/api/todos/${removed.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
    } catch (caught) {
      setTodos((current) => [...current, removed]);
      setError(caught instanceof Error ? caught.message : 'Could not delete todo.');
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const allSections = [
    { key: 'overdue', title: 'Overdue', items: sections.overdue, accent: 'overdue' },
    { key: 'pending', title: 'Upcoming', items: sections.pending, accent: 'upcoming' },
    { key: 'completed', title: 'Completed', items: sections.completed, accent: 'completed' },
  ] as const;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand-lockup" href="/"><span className="brand-mark"><Check size={18} aria-hidden="true" /></span><span>DAYMARK</span></Link>
        <nav className="top-nav" aria-label="Main navigation">
          <Link className="nav-link active" href="/">Tasks</Link>
          <Link className="nav-link" href="/calendar"><CalendarDays size={16} aria-hidden="true" /> Calendar</Link>
        </nav>
        <button className="icon-button" type="button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={17} /></button>
      </header>

      <section className="page-heading">
        <div><p className="eyebrow">YOUR WORKSPACE</p><h1>Today, considered.</h1><p className="muted-copy">A clear list is a kind of progress.</p></div>
        <label className="filter-control" htmlFor="priority-filter"><span>Priority</span>
          <select id="priority-filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as Priority | 'all')}>
            <option value="all">All levels</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </label>
      </section>

      <form className="create-panel" onSubmit={saveNewTodo}>
        <div className="panel-heading"><div><p className="eyebrow">CAPTURE</p><h2>Make a little progress</h2></div><span className="panel-index">01</span></div>
        <TodoFields form={form} setForm={setForm} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><span className="muted-copy">Due dates use Singapore time.</span><button className="primary-button" disabled={saving}><Plus size={17} aria-hidden="true" />{saving ? 'Saving…' : 'Add task'}</button></div>
      </form>

      <section className="list-area" aria-label="Todo list">
        <div className="list-heading"><div><p className="eyebrow">THE LIST</p><h2>Open loops</h2></div><span className="total-count">{filtered.length} {filtered.length === 1 ? 'task' : 'tasks'}</span></div>
        {loading ? <p className="empty-state" role="status">Loading your tasks…</p> : allSections.map((section) => (
          <section className={`todo-section ${section.accent}`} key={section.key} aria-labelledby={`${section.key}-heading`}>
            <div className="section-heading"><h3 id={`${section.key}-heading`}>{section.title}</h3><span>{section.items.length}</span></div>
            {section.items.length === 0 ? <p className="section-empty">Nothing here.</p> : (
              <ul className="todo-list">
                {section.items.map((todo) => (
                  <li className="todo-row" key={todo.id}>
                    <button className={`complete-button ${todo.completed ? 'is-complete' : ''}`} type="button" aria-label={todo.completed ? `Mark ${todo.title} incomplete` : `Mark ${todo.title} complete`} onClick={() => void toggleTodo(todo)}>
                      {todo.completed ? <Check size={16} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
                    </button>
                    <div className="todo-main">
                      <p className={todo.completed ? 'todo-title completed-title' : 'todo-title'}>{todo.title}</p>
                      <div className="todo-meta">
                        <span className={`priority-badge priority-${todo.priority}`}>{todo.priority}</span>
                        {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDateTime(todo.due_date)}</time>}
                        {todo.is_recurring && <span>{todo.recurrence_pattern}</span>}
                        {todo.reminder_minutes !== null && <span>Reminder set</span>}
                      </div>
                    </div>
                    <div className="todo-actions">
                      <button className="icon-button" type="button" title={`Edit ${todo.title}`} aria-label={`Edit ${todo.title}`} onClick={() => beginEdit(todo)}><Pencil size={16} /></button>
                      <button className="icon-button danger-icon" type="button" title={`Delete ${todo.title}`} aria-label={`Delete ${todo.title}`} onClick={() => setDeleting(todo)}><Trash2 size={16} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </section>

      {editing && (
        <dialog open className="dialog-backdrop" aria-labelledby="edit-title" onCancel={(event) => { event.preventDefault(); setEditing(null); }}>
          <form className="dialog-panel" onSubmit={saveEdit}>
            <div className="panel-heading"><div><p className="eyebrow">EDIT TASK</p><h2 id="edit-title">Adjust the details</h2></div><button className="icon-button" type="button" aria-label="Close edit dialog" onClick={() => setEditing(null)}>×</button></div>
            <TodoFields form={form} setForm={setForm} />
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={saving}><Check size={16} />Save changes</button></div>
          </form>
        </dialog>
      )}

      {deleting && (
        <dialog open className="dialog-backdrop" aria-labelledby="delete-title" onCancel={(event) => { event.preventDefault(); setDeleting(null); }}>
          <div className="dialog-panel compact-dialog">
            <p className="eyebrow">REMOVE TASK</p><h2 id="delete-title">Delete this task?</h2>
            <p className="dialog-copy">“{deleting.title}” will be permanently removed, along with its subtasks and tag links.</p>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDeleting(null)}>Cancel</button><button className="danger-button" type="button" onClick={() => void confirmDelete()}><Trash2 size={16} />Delete task</button></div>
          </div>
        </dialog>
      )}
      {error && !editing && <div className="toast-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}
      <footer className="app-footer"><span>DAYMARK / SINGAPORE</span><span>Small steps count <ChevronRight size={14} aria-hidden="true" /></span></footer>
    </main>
  );
}