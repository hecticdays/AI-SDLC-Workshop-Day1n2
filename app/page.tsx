'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Bookmark, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleCheck, FolderOpen,
  Layers3, LoaderCircle, Moon, Pencil, Plus, Search, SlidersHorizontal, Sun, Tag as TagIcon, Trash2, X } from 'lucide-react';
import type { Priority, Tag, Todo } from '@/lib/db';
import { applyFilters, DEFAULT_FILTER_STATE, deletePreset, hasActiveFilters, loadPresets, savePreset,
  type FilterPreset, type FilterState } from '@/lib/filters';
import { formatSingaporeDate, getSingaporeNow, singaporeInstant } from '@/lib/timezone';
import { useDebounce } from '@/lib/hooks/useDebounce';

interface CurrentUser { userId: number; username: string; demo: boolean }
interface Confirmation { title: string; text: string; action: () => Promise<void> }

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

export default function Home() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('medium');
  const [newTags, setNewTags] = useState<number[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  async function refresh() {
    const [nextTodos, nextTags] = await Promise.all([api<Todo[]>('/api/todos'), api<Tag[]>('/api/tags')]);
    setTodos(nextTodos);
    setTags(nextTags);
    const allowed = new Set(nextTags.map((tag) => tag.id));
    setFilters((current) => current.tagId !== 'all' && !allowed.has(current.tagId) ? { ...current, tagId: 'all' } : current);
    setNewTags((current) => current.filter((id) => allowed.has(id)));
    setEditingTodo((current) => current ? nextTodos.find((todo) => todo.id === current.id) ?? null : null);
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const current = await api<CurrentUser>('/api/auth/me');
        const [nextTodos, nextTags] = await Promise.all([api<Todo[]>('/api/todos'), api<Tag[]>('/api/tags')]);
        if (!active) return;
        setUser(current); setTodos(nextTodos); setTags(nextTags);
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
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('focus', update); window.removeEventListener('storage', storage); };
  }, [user]);

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
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
    await perform(async () => {
      await api('/api/todos', 'POST', { title: newTitle, priority: newPriority, tag_ids: newTags });
      await refresh(); setNewTitle(''); setNewTags([]);
    });
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
  const visible = applyFilters(todos, {
    ...filters, search: immediateSearch ?? (filters.search.trim() ? debouncedSearch : ''),
  });
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
          <button className="button secondary" disabled={!user} onClick={() => setManageTags(true)}><TagIcon size={16} />Manage tags</button>
        </div>
        {loading ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={28} /><h2>Loading your workspace</h2></div> : !user ?
          <div className="empty-state"><Layers3 size={32} /><h2>Sign-in required</h2><p>No active session is available.</p>{errorBanner}</div> : <>
          {errorBanner}
          <form className="composer" onSubmit={submitTodo}>
            <div className="composer-main"><Plus size={21} /><input aria-label="New task title" placeholder="What needs to get done?" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required />
              <button className="button primary" disabled={busy || !newTitle.trim()}><Plus size={16} /><span>Add task</span></button>
            </div>
            <div className="composer-options"><label className="compact-select">Priority<select aria-label="New task priority" value={newPriority} onChange={(event) => setNewPriority(event.target.value as Priority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <span className="option-divider" />{tags.map((tag) => <TagPill key={tag.id} tag={tag} selected={newTags.includes(tag.id)} onClick={() => setNewTags(newTags.includes(tag.id) ? newTags.filter((id) => id !== tag.id) : [...newTags, tag.id])} />)}
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
          </section>

          <div className="task-list">{sections.map((section) => section.rows.length > 0 && <section key={section.key} className={`task-section ${section.key}`} aria-label={section.title}>
            <header className="section-heading"><h2><span className="section-dot" />{section.title}<span className="section-count">{section.rows.length}</span></h2><span className="section-rule" /></header>
            {section.rows.map((todo) => <article key={todo.id} className={`task-row ${todo.completed ? 'is-completed' : ''}`} data-testid="task-row">
              <span className="task-status" aria-label={todo.completed ? 'Completed task' : 'Incomplete task'}>{todo.completed ? <CircleCheck size={21} /> : <Circle size={21} />}</span>
              <div className="task-content"><h3>{todo.title}</h3>
                <div className="task-meta"><span className={`priority ${todo.priority}`}><span />{todo.priority}</span>
                  {todo.due_date && <time dateTime={todo.due_date}>{formatSingaporeDate(todo.due_date, 'd MMM, HH:mm')}</time>}
                  {(todo.subtasks?.length ?? 0) > 0 && <span className="subtask-count" title="Subtask progress"><CheckCheck size={13} />{todo.subtasks?.filter((subtask) => subtask.completed).length}/{todo.subtasks?.length}</span>}
                </div>
                {todo.subtasks && todo.subtasks.length > 0 && <details className="subtask-details"><summary>Subtasks</summary><ul>{todo.subtasks.map((subtask) => <li key={subtask.id}>{subtask.completed ? <Check size={13} /> : <Circle size={11} />}{subtask.title}</li>)}</ul></details>}
              </div>
              <div className="task-tags">{todo.tags?.map((tag) => <TagPill key={tag.id} tag={tag} selected onClick={() => setFilters({ ...filters, tagId: tag.id })} />)}</div>
              <button className="icon-button edit-tags" aria-label={`Edit tags for ${todo.title}`} title="Edit task tags" disabled={busy} onClick={() => setEditingTodo(todo)}><TagIcon size={17} /></button>
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

    {editingTodo && <Modal title="Task tags" onClose={() => setEditingTodo(null)}><p className="task-dialog-title">{editingTodo.title}</p>{errorBanner}<div className="assignment-list">
      {tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={editingTodo.tags?.some((assigned) => assigned.id === tag.id) ?? false} disabled={busy}
        onChange={(event) => { void toggleTodoTag(editingTodo, tag, event.target.checked); }} /><span className="color-dot" style={{ backgroundColor: tag.color }} /><span className="truncate">{tag.name}</span></label>)}
      {tags.length === 0 && <p className="muted">No tags yet.</p>}
    </div><div className="modal-actions"><button className="button secondary" onClick={() => setEditingTodo(null)}>Done</button></div></Modal>}

    {savingPreset && user && <Modal title="Save filter" onClose={() => setSavingPreset(false)}>{errorBanner}<p className="filter-preview">{filterSummary(filters, tags)}</p><form onSubmit={(event) => { event.preventDefault(); void perform(async () => { setPresets(savePreset(user.userId, { id: crypto.randomUUID(), name: presetName.trim(), filters: { ...filters }, createdAt: getSingaporeNow().toISOString() })); setSavingPreset(false); setAdvanced(true); }); }}>
      <label>View name<input aria-label="View name" value={presetName} onChange={(event) => setPresetName(event.target.value)} required /></label><div className="modal-actions"><button className="button primary" disabled={busy || !presetName.trim()}><Bookmark size={16} />Save</button></div>
    </form></Modal>}

    {confirmation && <Modal title={confirmation.title} onClose={() => { if (!busy) setConfirmation(null); }}><p className="confirmation-text">{confirmation.text}</p>{errorBanner}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void perform(confirmation.action)}><Trash2 size={16} />Delete</button></div></Modal>}
  </div>;
}