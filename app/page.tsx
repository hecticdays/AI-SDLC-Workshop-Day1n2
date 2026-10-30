'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, BellRing, Bookmark, CalendarDays, Check, ChevronDown, ChevronRight, Circle, CircleCheck, FolderOpen,
  Layers3, LoaderCircle, Moon, Pencil, Plus, Search, SlidersHorizontal, Sun, Tag as TagIcon, Trash2, X } from 'lucide-react';
import type { Priority, RecurrencePattern, Subtask, Tag, Template, Todo } from '@/lib/db';
import { calculateProgress, parseTemplateSubtasks } from '@/lib/progress';
import PortabilityControls from '@/app/portability-controls';
import AccountControls from '@/app/account-controls';
import { applyFilters, DEFAULT_FILTER_STATE, deletePreset, hasActiveFilters, loadPresets, savePreset,
  type FilterPreset, type FilterState } from '@/lib/filters';
import { formatSingaporeDate, getSingaporeNow, singaporeInstant } from '@/lib/timezone';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { REMINDER_LABELS, reminderLabel } from '@/lib/reminders';

interface CurrentUser { userId: number; username: string; demo: boolean }
interface Confirmation { title: string; text: string; action: () => Promise<void> }
interface DraftSettings { dueDate: string; offset: string; recurrence: '' | RecurrencePattern; reminder: string; subtasks: string[] }
const emptyDraft: DraftSettings = { dueDate: '', offset: '', recurrence: '', reminder: '', subtasks: [] };

function localDateTimeToIso(value: string): string | null {
  return value ? singaporeInstant(value).toISOString() : null;
}

function isoToLocalDateTime(value: string | null): string {
  return value ? formatSingaporeDate(value, "yyyy-MM-dd'T'HH:mm") : '';
}

async function api<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed. Please try again.');
  return data;
}

function tagColors(color: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return { backgroundColor: color, color: luminance > 0.179 ? '#000000' : '#FFFFFF' };
}

function TagPill({ tag, selected, onClick }: { tag: Tag; selected?: boolean; onClick: () => void }) {
  return <button type="button" className={`tag-pill ${selected ? 'selected' : ''}`}
    style={selected ? tagColors(tag.color) : undefined} onClick={onClick}
    aria-pressed={selected ?? false} title={tag.name}>
    {selected ? <Check size={12} /> : <span className="color-dot" style={{ backgroundColor: tag.color }} />}
    <span>{tag.name}</span>
  </button>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
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
      <header className="modal-header"><h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close dialog" title="Close" onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </div>
  </dialog>;
}

function filterSummary(filters: FilterState, tags: Tag[]): string {
  const parts: string[] = [];
  if (filters.search.trim()) parts.push(`Search: "${filters.search.trim()}"`);
  if (filters.priority !== 'all') parts.push(`Priority: ${filters.priority}`);
  if (filters.tagId !== 'all') parts.push(`Tag: ${tags.find((tag) => tag.id === filters.tagId)?.name ?? 'unavailable'}`);
  if (filters.completion !== 'all') parts.push(`Status: ${filters.completion}`);
  if (filters.dueDateFrom) parts.push(`From: ${filters.dueDateFrom}`);
  if (filters.dueDateTo) parts.push(`To: ${filters.dueDateTo}`);
  return parts.join(' / ') || 'All todos';
}

function DraftChecklist({ items, onChange, disabled }: { items: string[]; onChange: (items: string[]) => void; disabled: boolean }) {
  const [title, setTitle] = useState('');
  function add() {
    if (disabled || !title.trim()) return;
    onChange([...items, title.trim()]); setTitle('');
  }
  return <div className="draft-checklist"><ul>{items.map((item, index) => <li key={index}><Circle size={12} /><span>{item}</span>
    <button type="button" className="icon-button" aria-label={`Remove draft subtask ${item}`} title="Remove subtask" disabled={disabled} onClick={() => onChange(items.filter((_, position) => position !== index))}><X size={14} /></button></li>)}</ul>
    <div className="checklist-add"><input aria-label="Draft subtask" placeholder="Add checklist item" value={title} disabled={disabled} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
      <button type="button" className="icon-button" aria-label="Add draft subtask" title="Add checklist item" disabled={disabled || !title.trim()} onClick={add}><Plus size={17} /></button></div>
  </div>;
}

function ScheduleFields({ value, onChange, disabled, concreteDate = false }: { value: DraftSettings; onChange: (value: DraftSettings) => void; disabled: boolean; concreteDate?: boolean }) {
  return <fieldset className="schedule-fields" disabled={disabled}><legend>Schedule</legend>
    {concreteDate && <label>Due date (SGT)<input aria-label="New task due date" type="datetime-local" value={value.dueDate} onChange={(event) => onChange({ ...value, dueDate: event.target.value, offset: '' })} /></label>}
    <label>Due in minutes<input aria-label="Due in minutes" type="number" min="1" max="100000000" step="1" value={value.offset} onChange={(event) => onChange({ ...value, offset: event.target.value, dueDate: '' })} /></label>
    <label>Repeat<select aria-label={concreteDate ? 'New task recurrence' : 'Template recurrence'} value={value.recurrence} onChange={(event) => onChange({ ...value, recurrence: event.target.value as DraftSettings['recurrence'] })}><option value="">Does not repeat</option>{(['daily', 'weekly', 'monthly', 'yearly'] as const).map((pattern) => <option key={pattern} value={pattern}>{pattern}</option>)}</select></label>
    <label>Reminder<select aria-label={concreteDate ? 'New task reminder' : 'Template reminder'} disabled={!value.dueDate && !value.offset} value={value.reminder} onChange={(event) => onChange({ ...value, reminder: event.target.value })}><option value="">No reminder</option>{[[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']].map(([minutes, label]) => <option key={minutes} value={minutes}>{label} before</option>)}</select></label>
  </fieldset>;
}

function SubtaskList({ todo, busy, onAction, onChanged }: { todo: Todo; busy: boolean; onAction: (action: () => Promise<void>) => Promise<boolean>; onChanged: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<Subtask | null>(null);
  const [optimisticCompletion, setOptimisticCompletion] = useState<{ id: number; completed: boolean } | null>(null);
  const pending = useRef(false);
  const children = (todo.subtasks ?? []).map((child) => child.id === optimisticCompletion?.id ? { ...child, completed: optimisticCompletion.completed } : child);
  const progress = calculateProgress(children);
  async function mutate(url: string, method: string, body?: unknown, onSuccess?: () => void) {
    if (busy || pending.current) return;
    pending.current = true;
    try {
      const saved = await onAction(async () => { await api(url, method, body); await onChanged(); });
      if (saved) onSuccess?.();
    } finally { pending.current = false; }
  }
  async function toggle(child: Subtask, completed: boolean) {
    if (busy || pending.current) return;
    setOptimisticCompletion({ id: child.id, completed });
    try { await mutate(`/api/subtasks/${child.id}`, 'PUT', { completed }); }
    finally { setOptimisticCompletion(null); }
  }
  return <div className="checklist">
    {progress.total > 0 && <div className="checklist-progress"><div><span>{progress.completed}/{progress.total} subtasks</span><span>{progress.percent}%</span></div>
      <div role="progressbar" aria-label={`Subtask progress for ${todo.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className={`progress-track ${progress.percent === 100 ? 'complete' : ''}`}><span style={{ width: `${progress.percent}%` }} /></div></div>}
    <details className="subtask-details"><summary>Subtasks</summary><ul>{children.map((child) => <li key={child.id}>
      <input type="checkbox" aria-label={`Complete subtask ${child.title}`} checked={child.completed} disabled={busy} onChange={(event) => void toggle(child, event.target.checked)} />
      {editing?.id === child.id ? <form className="checklist-rename" onSubmit={(event) => { event.preventDefault(); void mutate(`/api/subtasks/${child.id}`, 'PUT', { title: editing.title }, () => setEditing(null)); }}>
        <input aria-label="Subtask title" value={editing.title} disabled={busy} onChange={(event) => setEditing({ ...editing, title: event.target.value })} autoFocus onKeyDown={(event) => { if (event.key === 'Escape') setEditing(null); }} />
        <button className="icon-button" aria-label="Save subtask title" title="Save title" disabled={busy || !editing.title.trim()}><Check size={15} /></button>
        <button type="button" className="icon-button" aria-label="Cancel subtask rename" title="Cancel rename" disabled={busy} onClick={() => setEditing(null)}><X size={15} /></button>
      </form> : <><span className={child.completed ? 'checked-title' : ''}>{child.title}</span><button className="icon-button" aria-label={`Rename subtask ${child.title}`} title="Rename subtask" disabled={busy} onClick={() => setEditing({ ...child })}><Pencil size={14} /></button></>}
      <button className="icon-button danger-text" aria-label={`Delete subtask ${child.title}`} title="Delete subtask" disabled={busy} onClick={() => void mutate(`/api/subtasks/${child.id}`, 'DELETE')}><Trash2 size={14} /></button>
    </li>)}</ul><form className="checklist-add" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void mutate(`/api/todos/${todo.id}/subtasks`, 'POST', { title }, () => setTitle('')); }}>
      <input aria-label="New subtask" placeholder="Add subtask" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      <button className="icon-button" aria-label="Add subtask" title="Add subtask" disabled={busy || !title.trim()}><Plus size={17} /></button>
    </form></details>
  </div>;
}

interface TemplateDraft { id?: number; name: string; description: string; category: string; title: string; priority: Priority; settings: DraftSettings }

function TemplateEditor({ draft, busy, onSave }: { draft: TemplateDraft; busy: boolean; onSave: (draft: TemplateDraft) => void }) {
  const [value, setValue] = useState(draft);
  return <form className="template-editor" onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
    <label>Template name<input aria-label="Template name" value={value.name} required disabled={busy} onChange={(event) => setValue({ ...value, name: event.target.value })} /></label>
    <label>Description<textarea aria-label="Description" value={value.description} disabled={busy} onChange={(event) => setValue({ ...value, description: event.target.value })} /></label>
    <label>Category<input aria-label="Category" list="template-categories" value={value.category} disabled={busy} onChange={(event) => setValue({ ...value, category: event.target.value })} /><datalist id="template-categories">{['Work', 'Personal', 'Finance', 'Health', 'Education'].map((category) => <option key={category} value={category} />)}</datalist></label>
    <label>Task title<input aria-label="Template task title" value={value.title} required disabled={busy} onChange={(event) => setValue({ ...value, title: event.target.value })} /></label>
    <label>Priority<select aria-label="Template priority" value={value.priority} disabled={busy} onChange={(event) => setValue({ ...value, priority: event.target.value as Priority })}>{['high', 'medium', 'low'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
    <ScheduleFields value={value.settings} onChange={(settings) => setValue({ ...value, settings })} disabled={busy} />
    <DraftChecklist items={value.settings.subtasks} onChange={(subtasks) => setValue({ ...value, settings: { ...value.settings, subtasks } })} disabled={busy} />
    <div className="modal-actions"><button className="button primary" disabled={busy || !value.name.trim() || !value.title.trim()}><Check size={16} />Save template</button></div>
  </form>;
}

export default function Home() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const notifications = useNotifications(setError);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTER_STATE });
  const [immediateSearch, setImmediateSearch] = useState<string | null>(null);
  const debouncedSearch = useDebounce(filters.search, 300);
  const [advanced, setAdvanced] = useState(false);
  const [dark, setDark] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [manageTags, setManageTags] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#3B82F6');
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [editingDetails, setEditingDetails] = useState<Todo | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState<Priority>('medium');
  const [editTags, setEditTags] = useState<number[]>([]);
  const [editDueLocal, setEditDueLocal] = useState('');
  const [editRecurring, setEditRecurring] = useState(false);
  const [editRecurrence, setEditRecurrence] = useState<RecurrencePattern>('weekly');
  const [editReminder, setEditReminder] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newTags, setNewTags] = useState<number[]>([]);
  const [draftSettings, setDraftSettings] = useState<DraftSettings>({ ...emptyDraft });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [manageTemplates, setManageTemplates] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const pendingAction = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  async function refresh() {
    const [nextTodos, nextTags, nextTemplates] = await Promise.all([api<Todo[]>('/api/todos'), api<Tag[]>('/api/tags'), api<Template[]>('/api/templates')]);
    setTodos(nextTodos);
    setTags(nextTags);
    setTemplates(nextTemplates);
    const allowed = new Set(nextTags.map((tag) => tag.id));
    setFilters((current) => current.tagId !== 'all' && !allowed.has(current.tagId) ? { ...current, tagId: 'all' } : current);
    setNewTags((current) => current.filter((id) => allowed.has(id)));
    setEditTags((current) => current.filter((id) => allowed.has(id)));
    setEditingTodo((current) => current ? nextTodos.find((todo) => todo.id === current.id) ?? null : null);
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const sessionResponse = await fetch('/api/auth/me', { cache: 'no-store' });
        if (sessionResponse.status === 401) { if (active) window.location.replace('/login'); return; }
        if (!sessionResponse.ok) throw new Error('Unable to load your session. Please try again.');
        const current: CurrentUser = await sessionResponse.json();
        const [nextTodos, nextTags, nextTemplates] = await Promise.all([api<Todo[]>('/api/todos'), api<Tag[]>('/api/tags'), api<Template[]>('/api/templates')]);
        if (!active) return;
        setUser(current); setTodos(nextTodos); setTags(nextTags); setTemplates(nextTemplates);
        setPresets(loadPresets(current.userId));
      } catch (failure) {
        if (active) setError((failure as Error).message);
      } finally {
        if (active) {
          setLoading(false); setNow(getSingaporeNow());
          try { setDark(localStorage.getItem('todo-app:theme') === 'dark'); }
          catch { setDark(false); }
        }
      }
    }
    void initialize();
    const clock = setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => { active = false; clearInterval(clock); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const update = () => { void refresh().catch((failure: Error) => setError(failure.message)); };
    const storage = () => setPresets(loadPresets(user.userId));
    window.addEventListener('focus', update);
    window.addEventListener('todo-app:todos-changed', update);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('todo-app:todos-changed', update);
      window.removeEventListener('storage', storage);
    };
  }, [user]);

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  async function perform(action: () => Promise<void>) {
    if (pendingAction.current) return false;
    pendingAction.current = true;
    setBusy(true); setError(null);
    try { await action(); return true; } catch (failure) { setError((failure as Error).message); return false; }
    finally { pendingAction.current = false; setBusy(false); }
  }

  function clearAll() {
    setFilters({ ...DEFAULT_FILTER_STATE }); setImmediateSearch('');
  }

  function applyPreset(preset: FilterPreset) {
    const next = { ...preset.filters };
    if (next.tagId !== 'all' && !tags.some((tag) => tag.id === next.tagId)) next.tagId = 'all';
    setFilters(next); setImmediateSearch(next.search);
  }

  async function submitTag(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      await api(editingTag ? `/api/tags/${editingTag}` : '/api/tags', editingTag ? 'PUT' : 'POST', { name: tagName, color: tagColor });
      await refresh(); setTagName(''); setTagColor('#3B82F6'); setEditingTag(null);
    });
  }

  async function submitTodo(event: FormEvent) {
    event.preventDefault();
    if (pendingAction.current) return;
    const due = !draftSettings.offset && draftSettings.dueDate ? singaporeInstant(draftSettings.dueDate).toISOString() : null;
    const input = {
      title: newTitle.trim(), priority: newPriority, tag_ids: newTags,
      due_date: due, due_date_offset_minutes: draftSettings.offset ? Number(draftSettings.offset) : undefined,
      is_recurring: Boolean(draftSettings.recurrence), recurrence_pattern: draftSettings.recurrence || null,
      reminder_minutes: draftSettings.reminder ? Number(draftSettings.reminder) : null,
      subtasks: draftSettings.subtasks.map((title) => ({ title })),
    };
    const optimistic: Todo = {
      id: -getSingaporeNow().getTime(), user_id: user?.userId ?? 0, title: input.title, completed: false,
      due_date: input.due_date, priority: input.priority, is_recurring: input.is_recurring,
      recurrence_pattern: input.recurrence_pattern, reminder_minutes: input.reminder_minutes,
      last_notification_sent: null, created_at: getSingaporeNow().toISOString(), updated_at: null,
      tags: tags.filter((tag) => input.tag_ids.includes(tag.id)), subtasks: [],
    };
    setTodos((current) => [...current, optimistic]);
    await perform(async () => {
      try {
        await api('/api/todos', 'POST', input);
        await refresh();
        setNewTitle(''); setNewTags([]); setDraftSettings({ ...emptyDraft });
      } catch (failure) {
        setTodos((current) => current.filter((todo) => todo.id !== optimistic.id));
        throw failure;
      }
    });
  }

  function beginTodoEdit(todo: Todo) {
    setEditingDetails(todo);
    setEditTitle(todo.title);
    setEditPriority(todo.priority);
    setEditTags((todo.tags ?? []).map((tag) => tag.id));
    setEditDueLocal(isoToLocalDateTime(todo.due_date));
    setEditRecurring(todo.is_recurring);
    setEditRecurrence(todo.recurrence_pattern ?? 'weekly');
    setEditReminder(todo.reminder_minutes);
  }

  async function saveTodoEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingDetails || pendingAction.current) return;
    const original = editingDetails;
    const input = {
  title: editTitle.trim(), priority: editPriority, tag_ids: editTags,
      ...(editDueLocal !== isoToLocalDateTime(original.due_date) ? { due_date: localDateTimeToIso(editDueLocal) } : {}),
      is_recurring: editRecurring, recurrence_pattern: editRecurring ? editRecurrence : null,
      reminder_minutes: editReminder,
    };
    const optimistic = { ...original, ...input, tags: tags.filter((tag) => input.tag_ids.includes(tag.id)) };
    setTodos((current) => current.map((todo) => todo.id === original.id ? optimistic : todo));
    setEditingDetails(null);
    await perform(async () => {
      try {
        await api(`/api/todos/${original.id}`, 'PUT', input);
        await refresh();
      } catch (failure) {
        setTodos((current) => current.map((todo) => todo.id === original.id ? original : todo));
        throw failure;
      }
    });
  }

  async function toggleCompletion(todo: Todo) {
    if (pendingAction.current) return;
    const optimistic = { ...todo, completed: !todo.completed };
    setTodos((current) => current.map((item) => item.id === todo.id ? optimistic : item));
    await perform(async () => {
      try {
        await api(`/api/todos/${todo.id}`, 'PUT', { completed: optimistic.completed });
        await refresh();
      } catch (failure) {
        setTodos((current) => current.map((item) => item.id === todo.id ? todo : item));
        throw failure;
      }
    });
  }

  function confirmTodoDelete(todo: Todo) {
    setConfirmation({
      title: 'Delete todo?', text: `"${todo.title}" and its subtasks will be permanently deleted.`,
      action: async () => {
        setTodos((current) => current.filter((item) => item.id !== todo.id));
        try {
          await api(`/api/todos/${todo.id}`, 'DELETE');
          await refresh();
          setConfirmation(null);
        } catch (failure) {
          await refresh();
          throw failure;
        }
      },
    });
  }

  function openTemplateDraft() {
    const offset = draftSettings.dueDate ? Math.ceil((singaporeInstant(draftSettings.dueDate).getTime() - getSingaporeNow().getTime()) / 60_000).toString() : draftSettings.offset;
    setTemplateDraft({ name: '', description: '', category: '', title: newTitle, priority: newPriority, settings: { ...draftSettings, dueDate: '', offset } });
  }

  async function saveTemplate(draft: TemplateDraft) {
    await perform(async () => {
      await api(draft.id ? `/api/templates/${draft.id}` : '/api/templates', draft.id ? 'PUT' : 'POST', {
        name: draft.name, description: draft.description || null, category: draft.category || null,
        title_template: draft.title, priority: draft.priority,
        is_recurring: Boolean(draft.settings.recurrence), recurrence_pattern: draft.settings.recurrence || null,
        reminder_minutes: draft.settings.reminder ? Number(draft.settings.reminder) : null,
        due_date_offset_minutes: draft.settings.offset ? Number(draft.settings.offset) : null,
        subtasks: draft.settings.subtasks.map((title, position) => ({ title, position })),
      });
      await refresh(); setTemplateDraft(null);
    });
  }

  async function instantiateTemplate(id: number) {
    await perform(async () => { await api(`/api/templates/${id}/use`, 'POST'); await refresh(); setManageTemplates(false); });
  }

  async function toggleTodoTag(todo: Todo, tag: Tag, attach: boolean) {
    setEditingTodo({ ...todo, tags: attach ? [...(todo.tags ?? []), tag] : todo.tags?.filter((assigned) => assigned.id !== tag.id) });
    await perform(async () => {
      try {
        await api(`/api/todos/${todo.id}/tags`, attach ? 'POST' : 'DELETE', { tag_id: tag.id });
        await refresh();
      } catch (failure) {
        setEditingTodo(todo);
        throw failure;
      }
    });
  }

  const active = hasActiveFilters(filters);
  const search = immediateSearch ?? (filters.search.trim() ? debouncedSearch : '');
  const { priority, tagId, completion, dueDateFrom, dueDateTo } = filters;
  const visible = useMemo(() => applyFilters(todos, {
    search, priority, tagId, completion, dueDateFrom, dueDateTo,
  }), [todos, search, priority, tagId, completion, dueDateFrom, dueDateTo]);
  const sections = [
    { title: 'Overdue', key: 'overdue', rows: visible.filter((todo) => !todo.completed && todo.due_date && now && singaporeInstant(todo.due_date).getTime() < now.getTime()) },
    { title: 'Pending', key: 'pending', rows: visible.filter((todo) => !todo.completed && (!todo.due_date || !now || singaporeInstant(todo.due_date).getTime() >= now.getTime())) },
    { title: 'Completed', key: 'completed', rows: visible.filter((todo) => todo.completed) },
  ];

  const errorBanner = error && <div role="alert" className="error-banner"><span>{error}</span>
    <button className="icon-button" aria-label="Dismiss error" title="Dismiss" onClick={() => setError(null)}><X size={16} /></button>
  </div>;

  return <div className="app-shell">
    <header className="app-header">
      <Link href="/" className="brand"><span className="brand-icon"><Layers3 size={22} /></span>Daybook<span className="brand-label">WORKSPACE</span></Link>
      <div className="header-right">
        {user?.demo && <span className="demo-label">Local demo</span>}
        {user && <AccountControls demo={user.demo} />}
        {user && <button type="button" className={`button secondary notification-toggle ${notifications.permission === 'granted' ? 'enabled' : ''}`}
          disabled={notifications.permission === 'granted' || notifications.permission === 'unsupported'}
          title={notifications.permission === 'denied' ? 'Allow notifications in your browser site settings' : undefined}
          onClick={() => void notifications.requestPermission()}>
          {notifications.permission === 'granted' ? <BellRing size={16} /> : <Bell size={16} />}
          {notifications.permission === 'granted' ? 'Notifications On' : notifications.permission === 'denied' ? 'Notifications Blocked'
            : notifications.permission === 'unsupported' ? 'Notifications Unavailable' : 'Enable Notifications'}
        </button>}
        <span className="header-date">{now && formatSingaporeDate(now, 'EEE, d MMM')}</span>
        <button className="icon-button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Light theme' : 'Dark theme'}
          onClick={() => { const next = !dark; setDark(next); try { localStorage.setItem('todo-app:theme', next ? 'dark' : 'light'); } catch { setError('Theme preference could not be saved.'); } }}>
          {dark ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <span className="avatar" title={user?.username ?? 'Guest'}>{user?.username.slice(0, 2).toUpperCase() ?? 'DB'}</span>
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <p className="eyebrow">YOUR SPACE</p>
        <button className={`nav-item ${!active ? 'current' : ''}`} onClick={clearAll}><FolderOpen size={18} /><span>All tasks</span><span className="nav-count">{todos.length}</span></button>
        <div className="sidebar-heading"><p className="eyebrow">TAGS</p><button className="icon-button" aria-label="Manage tags" title="Manage tags" disabled={!user} onClick={() => setManageTags(true)}><Plus size={17} /></button></div>
        <div className="sidebar-tags">{tags.map((tag) => <button key={tag.id} title={tag.name} className={`nav-item ${filters.tagId === tag.id ? 'current' : ''}`}
          onClick={() => setFilters({ ...filters, tagId: filters.tagId === tag.id ? 'all' : tag.id })}>
          <span className="color-dot" style={{ backgroundColor: tag.color }} /><span className="truncate">{tag.name}</span>
          <span className="nav-count">{todos.filter((todo) => todo.tags?.some((assigned) => assigned.id === tag.id)).length}</span>
        </button>)}</div>
        <div className="sidebar-foot"><span className="status-dot" />{user?.username ?? 'Not signed in'}<small>Asia/Singapore</small></div>
      </aside>

      <main>
        <div className="page-heading"><div><p className="eyebrow">PERSONAL WORKSPACE</p><h1>My tasks<span className="heading-dot">.</span></h1></div>
          <Link className="button secondary" href="/calendar"><CalendarDays size={16} />Calendar</Link>
          <button className="button secondary" disabled={!user} onClick={() => setManageTags(true)}><TagIcon size={16} />Manage tags</button>
        </div>
        {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={28} /><h2>Loading your workspace</h2></div> : !user ?
          <div className="empty-state"><Layers3 size={32} /><h2>Sign-in required</h2><p>No active session is available.</p>{errorBanner}</div> : <>
          {errorBanner}
          <div className="workspace-tools"><button className="button secondary" disabled={busy} onClick={() => { setTemplateCategory(''); setManageTemplates(true); }}><Bookmark size={16} />Templates</button><PortabilityControls onImported={refresh} /></div>
          <form className="composer" onSubmit={submitTodo}>
            <div className="composer-main"><Plus size={21} /><input aria-label="New task title" placeholder="What needs to get done?" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required />
              <button className="button primary" disabled={busy || !newTitle.trim()}><Plus size={16} /><span>Add task</span></button>
            </div>
            {newTitle.length > 200 && <p className="field-warning" role="status">Long titles can be harder to scan. This task will still be saved.</p>}
            <div className="composer-options"><label className="compact-select">Priority<select aria-label="New task priority" value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <span className="option-divider" />{tags.map((tag) => <TagPill key={tag.id} tag={tag} selected={newTags.includes(tag.id)} onClick={() => setNewTags(newTags.includes(tag.id) ? newTags.filter((id) => id !== tag.id) : [...newTags, tag.id])} />)}
            </div>
            <div className="composer-draft"><ScheduleFields value={draftSettings} onChange={setDraftSettings} disabled={busy} concreteDate />
              <DraftChecklist items={draftSettings.subtasks} onChange={(subtasks) => setDraftSettings({ ...draftSettings, subtasks })} disabled={busy} />
              <div className="draft-actions"><select aria-label="Use template" value="" disabled={busy || templates.length === 0} onChange={(event) => { if (event.target.value) void instantiateTemplate(Number(event.target.value)); }}><option value="">Use template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.category ? ` (${template.category})` : ''}</option>)}</select>
                {newTitle.trim() && <button type="button" className="text-button" disabled={busy} onClick={openTemplateDraft}><Bookmark size={15} />Save as template</button>}</div>
            </div>
          </form>

          <section className="filters" aria-label="Task filters">
            <div className="filter-bar">
              <div className="search-box"><Search size={18} /><input aria-label="Search todos and subtasks" placeholder="Search todos and subtasks..." value={filters.search}
                onChange={(event) => { setImmediateSearch(null); setFilters({ ...filters, search: event.target.value }); }} />
                {filters.search && <button className="icon-button" aria-label="Clear search" title="Clear search" onClick={() => { setImmediateSearch(''); setFilters({ ...filters, search: '' }); }}><X size={16} /></button>}
              </div>
              <select aria-label="Filter by priority" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value as FilterState['priority'] })}><option value="all">All Priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
              {tags.length > 0 && <select aria-label="Filter by tag" value={filters.tagId} onChange={(event) => setFilters({ ...filters, tagId: event.target.value === 'all' ? 'all' : Number(event.target.value) })}><option value="all">All Tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
              <button className={`button advanced-toggle ${advanced ? 'active' : ''}`} aria-expanded={advanced} aria-controls="advanced-filters" onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={16} /><span>Advanced</span>{advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            </div>
            {advanced && <div className="advanced-panel" id="advanced-filters">
              <div className="advanced-fields"><label>Completion status<select aria-label="Completion status" value={filters.completion} onChange={(event) => setFilters({ ...filters, completion: event.target.value as FilterState['completion'] })}><option value="all">All Todos</option><option value="incomplete">Incomplete Only</option><option value="completed">Completed Only</option></select></label>
                <label>Due date from<input aria-label="Due date from" type="date" value={filters.dueDateFrom ?? ''} onChange={(event) => setFilters({ ...filters, dueDateFrom: event.target.value || null })} /></label>
                <label>Due date to<input aria-label="Due date to" type="date" value={filters.dueDateTo ?? ''} onChange={(event) => setFilters({ ...filters, dueDateTo: event.target.value || null })} /></label>
              </div>
              {filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo && <p className="field-warning">From date is after To date.</p>}
              <div className="preset-list"><span className="eyebrow"><Bookmark size={13} />SAVED VIEWS</span>{presets.length === 0 && <span className="muted">No saved views</span>}
                {presets.map((preset) => <span className="preset" key={preset.id}><button title={filterSummary(preset.filters, tags)} onClick={() => applyPreset(preset)}>{preset.name}</button><button aria-label={`Delete preset ${preset.name}`} title="Delete saved view" onClick={() => setConfirmation({ title: 'Delete saved view?', text: preset.name, action: async () => { setPresets(deletePreset(user.userId, preset.id)); setConfirmation(null); } })}><X size={13} /></button></span>)}
              </div>
            </div>}
            <div className="results-bar"><span aria-live="polite">{visible.length} {visible.length === 1 ? 'task' : 'tasks'}{active ? ` of ${todos.length}` : ''}</span>
              {active && <div className="filter-actions"><button className="text-button danger-text" onClick={clearAll}><X size={14} />Clear All</button><button className="text-button" onClick={() => { setPresetName(''); setSavingPreset(true); }}><Bookmark size={14} />Save Filter</button></div>}
            </div>
            {active && <div className="active-filter-summary"><p role="status" aria-label="Active filters">{filterSummary(filters, tags)}</p>
              {filters.tagId !== 'all' && <button className="icon-button" aria-label="Clear tag filter" title="Clear tag filter" onClick={() => setFilters({ ...filters, tagId: 'all' })}><X size={15} /></button>}
            </div>}
          </section>

          <div className="task-list">{sections.map((section) => section.rows.length > 0 && <section key={section.key} className={`task-section ${section.key}`} aria-label={section.title}>
            <header className="section-heading"><h2><span className="section-dot" />{section.title}<span className="section-count">{section.rows.length}</span></h2><span className="section-rule" /></header>
            {section.rows.map((todo) => <article key={todo.id} className={`task-row ${todo.completed ? 'is-completed' : ''}`} data-testid="task-row">
              <button className="task-status" aria-label={`${todo.completed ? 'Reopen' : 'Complete'} task ${todo.title}`} title={todo.completed ? 'Reopen task' : 'Complete task'} disabled={busy} onClick={() => void toggleCompletion(todo)}>{todo.completed ? <CircleCheck size={21} /> : <Circle size={21} />}</button>
              <div className="task-content"><h3>{todo.title}</h3>
                <div className="task-meta"><span className={`priority ${todo.priority}`}><span />{todo.priority}</span>
                  {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDate(todo.due_date, 'd MMM, HH:mm')}</time>}
                  {todo.is_recurring && <span className="recurrence-label">Repeats {todo.recurrence_pattern}</span>}
                  {todo.reminder_minutes !== null && <span className="reminder-label" aria-label={`Reminder ${reminderLabel(todo.reminder_minutes)} before due`}>🔔 {reminderLabel(todo.reminder_minutes)}</span>}
                </div>
                <SubtaskList todo={todo} busy={busy} onAction={perform} onChanged={refresh} />
              </div>
              <div className="task-tags">{todo.tags?.map((tag) => <TagPill key={tag.id} tag={tag} selected onClick={() => setFilters({ ...filters, tagId: tag.id })} />)}</div>
              <button className="icon-button" aria-label={`Edit ${todo.title}`} title="Edit task" disabled={busy} onClick={() => beginTodoEdit(todo)}><Pencil size={16} /></button>
              <button className="icon-button edit-tags" aria-label={`Edit tags for ${todo.title}`} title="Edit task tags" disabled={busy} onClick={() => setEditingTodo(todo)}><TagIcon size={17} /></button>
              <button className="icon-button danger-text delete-task" aria-label={`Delete task ${todo.title}`} title="Delete task" disabled={busy} onClick={() => confirmTodoDelete(todo)}><Trash2 size={16} /></button>
            </article>)}
          </section>)}</div>
          {visible.length === 0 && <div className="empty-state"><Search size={30} /><h2>{todos.length ? 'No todos match your filters' : 'You have no todos yet'}</h2>{active && <button className="button secondary" onClick={clearAll}>Clear All</button>}</div>}
          <footer className="workspace-footer"><span><span className="status-dot" />{busy ? 'Saving changes' : 'Up to date'}</span><span>Singapore time (SGT)</span></footer>
        </>}
      </main>
    </div>

    {manageTags && <Modal title="Manage tags" onClose={() => { setManageTags(false); setEditingTag(null); setTagName(''); setTagColor('#3B82F6'); }}>
      {errorBanner}
      <ul className="managed-tags">{tags.map((tag) => <li key={tag.id}><span className="color-dot" style={{ backgroundColor: tag.color }} /><span className="truncate" title={tag.name}>{tag.name}</span><span className="tag-hex">{tag.color.toUpperCase()}</span>
        <button className="icon-button" aria-label={`Edit tag ${tag.name}`} title="Edit tag" disabled={busy} onClick={() => { setEditingTag(tag.id); setTagName(tag.name); setTagColor(tag.color); }}><Pencil size={15} /></button>
        <button className="icon-button danger-text" aria-label={`Delete tag ${tag.name}`} title="Delete tag" disabled={busy} onClick={() => setConfirmation({ title: 'Delete tag?', text: `"${tag.name}" will be removed from all tasks. Tasks will not be deleted.`, action: async () => { await api(`/api/tags/${tag.id}`, 'DELETE'); await refresh(); if (editingTag === tag.id) { setEditingTag(null); setTagName(''); } setConfirmation(null); } })}><Trash2 size={15} /></button>
      </li>)}</ul>
      {tags.length === 0 && <p className="muted">No tags yet.</p>}
      <form className="tag-form" onSubmit={submitTag}><h3>{editingTag ? 'Edit tag' : 'New tag'}</h3>
        <label>Tag name<input aria-label="Tag name" value={tagName} onChange={(event) => setTagName(event.target.value)} required /></label>
        <label>Color<div className="color-inputs"><input aria-label="Tag color picker" type="color" value={/^#[\da-f]{6}$/i.test(tagColor) ? tagColor : '#3B82F6'} onChange={(event) => setTagColor(event.target.value)} /><input aria-label="Tag hex color" value={tagColor} pattern="#[0-9A-Fa-f]{6}" onChange={(event) => setTagColor(event.target.value)} required /></div></label>
        <div className="modal-actions">{editingTag && <button className="button secondary" type="button" onClick={() => { setEditingTag(null); setTagName(''); setTagColor('#3B82F6'); }}>Cancel edit</button>}
          <button className="button primary" disabled={busy || !tagName.trim()}>{editingTag ? <Check size={16} /> : <Plus size={16} />}{editingTag ? 'Update tag' : 'Create tag'}</button></div>
      </form>
    </Modal>}

    {manageTemplates && <Modal title="Templates" onClose={() => { if (!busy) setManageTemplates(false); }}>
      {errorBanner}<div className="template-toolbar"><label>Category<select aria-label="Template category" value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}><option value="">All categories</option>{[...new Set(templates.map((template) => template.category).filter((category): category is string => Boolean(category)))].sort().map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <button className="button secondary" disabled={busy} onClick={() => setTemplateDraft({ name: '', description: '', category: '', title: '', priority: 'medium', settings: { ...emptyDraft } })}><Plus size={16} />New template</button></div>
      <ul className="template-list">{templates.filter((template) => !templateCategory || template.category === templateCategory).map((template) => <li key={template.id}>
        <div className="template-title"><strong>{template.name}</strong>{template.category && <span>{template.category}</span>}</div>
        {template.description && <p>{template.description}</p>}
        <div className="template-meta"><span className={`priority ${template.priority}`}>{template.priority}</span>{template.is_recurring && <span>Repeats {template.recurrence_pattern}</span>}{template.reminder_minutes !== null && <span>Reminder {template.reminder_minutes} min before</span>}{template.due_date_offset_minutes !== null && <span>Due in {template.due_date_offset_minutes} min</span>}<span>{parseTemplateSubtasks(template.subtasks_json).length} subtasks</span></div>
        <div className="template-actions"><button className="button secondary" aria-label={`Use template ${template.name}`} disabled={busy} onClick={() => void instantiateTemplate(template.id)}><Plus size={15} />Use</button>
          <button className="icon-button" aria-label={`Edit template ${template.name}`} title="Edit template" disabled={busy} onClick={() => setTemplateDraft({ id: template.id, name: template.name, description: template.description ?? '', category: template.category ?? '', title: template.title_template, priority: template.priority,
            settings: { ...emptyDraft, offset: template.due_date_offset_minutes?.toString() ?? '', recurrence: template.is_recurring ? template.recurrence_pattern ?? '' : '', reminder: template.reminder_minutes?.toString() ?? '', subtasks: parseTemplateSubtasks(template.subtasks_json).sort((left, right) => left.position - right.position).map((child) => child.title) } })}><Pencil size={15} /></button>
          <button className="icon-button danger-text" aria-label={`Delete template ${template.name}`} title="Delete template" disabled={busy} onClick={() => setConfirmation({ title: 'Delete template?', text: `Delete "${template.name}"? Existing tasks will not change.`, action: async () => { await api(`/api/templates/${template.id}`, 'DELETE'); await refresh(); setConfirmation(null); setTemplateCategory(''); } })}><Trash2 size={15} /></button></div>
      </li>)}</ul>{templates.filter((template) => !templateCategory || template.category === templateCategory).length === 0 && <p className="muted">No templates.</p>}
    </Modal>}

    {templateDraft && <Modal title={templateDraft.id ? 'Edit template' : 'Save template'} onClose={() => { if (!busy) setTemplateDraft(null); }}>{errorBanner}<TemplateEditor draft={templateDraft} busy={busy} onSave={(draft) => void saveTemplate(draft)} /></Modal>}

    {editingTodo && <Modal title="Task tags" onClose={() => setEditingTodo(null)}><p className="task-dialog-title">{editingTodo.title}</p>{errorBanner}<div className="assignment-list">
      {tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={editingTodo.tags?.some((assigned) => assigned.id === tag.id) ?? false} disabled={busy}
        onChange={(event) => { void toggleTodoTag(editingTodo, tag, event.target.checked); }} /><span className="color-dot" style={{ backgroundColor: tag.color }} /><span className="truncate">{tag.name}</span></label>)}
      {tags.length === 0 && <p className="muted">No tags yet.</p>}
    </div><div className="modal-actions"><button className="button secondary" onClick={() => setEditingTodo(null)}>Done</button></div></Modal>}

    {editingDetails && <Modal title="Edit task" onClose={() => setEditingDetails(null)}>
      {errorBanner}
      <form className="todo-edit-form" onSubmit={(event) => void saveTodoEdit(event)}>
        <label>Task title<input aria-label="Edit todo title" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required /></label>
        <label>Priority<select aria-label="Edit todo priority" value={editPriority} onChange={(event) => setEditPriority(event.target.value as Priority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <fieldset className="todo-edit-tags" disabled={busy}><legend>Tags</legend><div className="tag-selector">
          {tags.map((tag) => <TagPill key={tag.id} tag={tag} selected={editTags.includes(tag.id)} onClick={() => setEditTags((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} />)}
          {tags.length === 0 && <span className="muted">No tags yet.</span>}
        </div></fieldset>
        <label>Due date · Singapore time<input aria-label="Edit todo due date" type="datetime-local" value={editDueLocal} onChange={(event) => setEditDueLocal(event.target.value)} /></label>
        <label className="todo-toggle"><input type="checkbox" checked={editRecurring} onChange={(event) => setEditRecurring(event.target.checked)} />Repeat</label>
        {editRecurring && <label>Pattern<select aria-label="Edit todo recurrence pattern" value={editRecurrence} onChange={(event) => setEditRecurrence(event.target.value as RecurrencePattern)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>}
        <label>Reminder<select aria-label="Edit todo reminder" disabled={!editDueLocal} value={editReminder ?? ''} onChange={(event) => setEditReminder(event.target.value ? Number(event.target.value) : null)}><option value="">None</option>{Object.entries(REMINDER_LABELS).map(([minutes, label]) => <option key={minutes} value={minutes}>{label} before</option>)}</select></label>
        <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEditingDetails(null)}>Cancel</button><button className="button primary" disabled={busy || !editTitle.trim()}><Check size={16} />Save changes</button></div>
      </form>
    </Modal>}

    {savingPreset && user && <Modal title="Save filter" onClose={() => setSavingPreset(false)}>{errorBanner}<p className="filter-preview">{filterSummary(filters, tags)}</p><form onSubmit={(event) => { event.preventDefault(); void perform(async () => { setPresets(savePreset(user.userId, { id: crypto.randomUUID(), name: presetName.trim(), filters: { ...filters }, createdAt: getSingaporeNow().toISOString() })); setSavingPreset(false); setAdvanced(true); }); }}>
      <label>View name<input aria-label="View name" value={presetName} onChange={(event) => setPresetName(event.target.value)} required /></label><div className="modal-actions"><button className="button primary" disabled={busy || !presetName.trim()}><Bookmark size={16} />Save</button></div>
    </form></Modal>}

    {confirmation && <Modal title={confirmation.title} onClose={() => { if (!busy) setConfirmation(null); }}><p className="confirmation-text">{confirmation.text}</p>{errorBanner}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void perform(confirmation.action)}><Trash2 size={16} />Delete</button></div></Modal>}
  </div>;
}