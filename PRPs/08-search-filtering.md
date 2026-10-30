# Search & Filtering

**Person 4 status:** Implemented and verified on 2026-10-30. See [EVALUATION.md](../EVALUATION.md) for evidence and cross-owner handoffs. This PRP is authoritative for search scope: todo/subtask titles are searched; tag names are selected using the separate tag filter, not searched as text.

Client-side search and multi-criteria filtering over the todo list, with savable filter presets.

**Dependencies**: This is a **client-side, in-memory** feature layered on top of the `todos` list already fetched via [PRP 01: Todo CRUD Operations](./01-todo-crud-operations.md)'s `GET /api/todos` (including nested subtasks from [PRP 05](./05-subtasks-progress.md), priority from [PRP 02](./02-priority-system.md), and tags from [PRP 06](./06-tag-system.md)). It does not require new database tables or server endpoints — only client-side filtering logic plus `localStorage` for saved presets.

[← PRP Index](./README.md)

---

## Feature Overview

Users need to find specific todos quickly as their list grows. This feature provides:

- A real-time (debounced) text search across todo titles **and** subtask titles.
- Quick filters for priority and tag.
- An "Advanced" panel with completion status and due-date range filtering.
- The ability to save the current combination of filters as a named preset in `localStorage` and re-apply it later with one click.

All filtering happens **entirely in the browser** against the `Todo[]` array already loaded from `GET /api/todos`. There is no new database table, no new API route, and no server-side search index. This keeps the feature fast (no network round-trip per keystroke) and simple to reason about, consistent with the project's "monolithic `app/page.tsx`" convention.

---

## User Stories

- **As a user with a long todo list**, I want to type part of a title and instantly see matching todos, so I don't have to scroll to find something.
- **As a user planning my week**, I want to filter todos to a specific due-date range, so I can focus on what's coming up.
- **As a user organizing work vs. personal tasks**, I want to combine a tag filter with a priority filter, so I see only "High priority Work" items.
- **As a user who reviews progress**, I want a "Completed Only" filter so I can see what I've finished this week.
- **As a returning user**, I want to save a filter combination I use every morning (e.g. "Today's High Priority") so I don't have to re-select it each time.
- **As a user who mistyped a search**, I want a one-click "Clear All" so I can reset the list without clearing each filter individually.

---

## User Flow

1. User opens the app; the todo list renders unfiltered (all sections: Overdue, Pending, Completed).
2. User types into the search box (🔍 icon, placeholder `"Search todos and subtasks..."`).
   - After a 300ms pause in typing, the list re-renders to only todos whose `title` **or** any `subtasks[].title` case-insensitively contains the query.
   - A ✕ button appears in the search box; clicking it clears the query immediately (no debounce on clear).
3. User optionally selects a **Priority** from the quick-filter dropdown ("All Priorities" / High / Medium / Low).
4. If tags exist, user optionally selects a **Tag** from the quick-filter dropdown ("All Tags" / one of the user's tags).
5. User clicks **"▶ Advanced"** to expand the advanced panel (button flips to **"▼ Advanced"**, background turns blue while active):
   - Selects a **Completion Status** (`All Todos` / `Incomplete Only` / `Completed Only`).
   - Optionally sets **Due Date From** and/or **Due Date To** (`YYYY-MM-DD`). Either can be used alone.
6. As soon as any filter is active, **"Clear All"** (red) and **"💾 Save Filter"** (green) buttons appear.
7. User clicks **"💾 Save Filter"** → a modal opens showing a live preview of the active filters (e.g. `Search: "meeting" · Priority: High · Tag: Work · Completion: Incomplete · Date: 2025-11-01 to 2025-11-07`) and a name input. User enters a name and clicks **"Save"** → preset is written to `localStorage` and appears as a pill in the Advanced panel.
8. Later, user clicks a saved preset pill → all five filter dimensions are set from the preset in one action, overwriting current filters.
9. User clicks the ✕ on a preset pill → preset is removed from `localStorage` after confirmation.
10. User clicks **"Clear All"** → all filters reset to defaults; full list reappears.

Section counters ("Overdue (X)", "Pending (X)", "Completed (X)") always reflect the **post-filter** counts, and a section with zero matching todos is hidden rather than shown empty.

---

## Technical Requirements

### Data source

No new tables or endpoints. Consumes `Todo[]` as already returned by `GET /api/todos` (see PRP 01), where each `Todo` may include `subtasks?: Subtask[]` (PRP 05) and `tags?: Tag[]` (PRP 06):

```typescript
// Existing types — imported from lib/db.ts, not redefined here
export type Priority = 'high' | 'medium' | 'low';

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null; // ISO string, Singapore local time
  priority: Priority;
  // ...recurrence/reminder fields from PRP 03/04...
  subtasks?: Subtask[];
  tags?: Tag[];
}
```

### Filter state

```typescript
export interface FilterState {
  search: string;                 // raw (non-debounced) input value
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: 'all' | 'incomplete' | 'completed';
  dueDateFrom: string | null;     // 'YYYY-MM-DD'
  dueDateTo: string | null;       // 'YYYY-MM-DD'
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueDateFrom: null,
  dueDateTo: null,
};

export function hasActiveFilters(f: FilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.priority !== 'all' ||
    f.tagId !== 'all' ||
    f.completion !== 'all' ||
    f.dueDateFrom !== null ||
    f.dueDateTo !== null
  );
}
```

### Filter application — exact order matters

Filters combine with **AND** logic, applied in this order (per `USER_GUIDE.md` "Filter Priority" section): search → priority → tag → completion → date range.

```typescript
// lib/filters.ts
import { formatSingaporeDate } from '@/lib/timezone';

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  let result = todos;

  // 1. Search (title OR any subtask title, case-insensitive, partial match)
  const query = filters.search.trim().toLowerCase();
  if (query) {
    result = result.filter((todo) => {
      if (todo.title.toLowerCase().includes(query)) return true;
      return (todo.subtasks ?? []).some((st) =>
        st.title.toLowerCase().includes(query)
      );
    });
  }

  // 2. Priority
  if (filters.priority !== 'all') {
    result = result.filter((todo) => todo.priority === filters.priority);
  }

  // 3. Tag
  if (filters.tagId !== 'all') {
    result = result.filter((todo) =>
      (todo.tags ?? []).some((tag) => tag.id === filters.tagId)
    );
  }

  // 4. Completion status
  if (filters.completion === 'incomplete') {
    result = result.filter((todo) => !todo.completed);
  } else if (filters.completion === 'completed') {
    result = result.filter((todo) => todo.completed);
  }

  // 5. Due date range (only matches todos WITH a due_date)
  if (filters.dueDateFrom || filters.dueDateTo) {
    result = result.filter((todo) => {
      if (!todo.due_date) return false;
      const due = formatSingaporeDate(todo.due_date);
      if (filters.dueDateFrom && due < filters.dueDateFrom) return false;
      if (filters.dueDateTo && due > filters.dueDateTo) return false;
      return true;
    });
  }

  return result;
}
```

### Debounced search input

```typescript
// lib/hooks/useDebounce.ts
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
```

`app/page.tsx` holds `filters: FilterState` as React state; the search `<input>` is bound directly to `filters.search` for instant visual feedback, while the **debounced** value of `filters.search` (via `useDebounce(filters.search, 300)`) is what's actually passed into `applyFilters`. Clearing via the ✕ button sets `filters.search` to `''` and should not wait for the debounce.

### Saved filter presets — `localStorage`

```typescript
export interface FilterPreset {
  id: string;        // crypto.randomUUID()
  name: string;
  filters: FilterState;
  createdAt: string; // ISO, from getSingaporeNow()
}

const PRESETS_KEY = 'todo-app:filter-presets';

export function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to load filter presets:', error);
    return [];
  }
}

export function savePreset(preset: FilterPreset): FilterPreset[] {
  const presets = [...loadPresets(), preset];
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(id: string): FilterPreset[] {
  const presets = loadPresets().filter((p) => p.id !== id);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}
```

Presets are **per-browser**, not synced server-side, and persist across page refreshes but not across devices/browsers. The tested implementation in `lib/filters.ts` additionally scopes keys to `todo-app:filter-presets:{userId}`, validates the complete persisted shape, and reports write failures. Call `loadPresets(userId)`, `savePreset(userId, preset)`, and `deletePreset(userId, id)`; the earlier snippets illustrate the flow rather than the final storage implementation.

### Cross-feature refresh

After a successful client-side todo/subtask mutation or template use, dispatch `window.dispatchEvent(new Event('todo-app:todos-changed'))`. The main page refetches nested todos and tags and reapplies the current filters. Person 3's routes and template execution remain separate features; tests mutate isolated fixtures to verify this integration contract, including collapsed subtasks, renames, deletions, and new checklist-bearing tasks.

---

## UI Components

### Search input with clear button

```tsx
function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
        🔍
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search todos and subtasks..."
        className="w-full pl-10 pr-10 py-2 rounded-lg border dark:bg-gray-700 dark:border-gray-600"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

### Advanced panel toggle

```tsx
function AdvancedToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
        expanded
          ? 'bg-blue-500 text-white'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
      }`}
    >
      {expanded ? '▼ Advanced' : '▶ Advanced'}
    </button>
  );
}
```

### Saved preset pill

```tsx
function SavedPresetPill({
  preset,
  onApply,
  onDelete,
}: {
  preset: FilterPreset;
  onApply: (filters: FilterState) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm dark:border-gray-600">
      <button onClick={() => onApply(preset.filters)} className="font-medium">
        {preset.name}
      </button>
      <button
        onClick={() => onDelete(preset.id)}
        aria-label={`Delete preset ${preset.name}`}
        className="text-gray-400 hover:text-red-500"
      >
        ✕
      </button>
    </span>
  );
}
```

### Filter action buttons

```tsx
function FilterActions({
  visible,
  onClearAll,
  onSaveFilter,
}: {
  visible: boolean;
  onClearAll: () => void;
  onSaveFilter: () => void;
}) {
  if (!visible) return null;
  return (
    <div className="flex gap-2">
      <button onClick={onClearAll} className="text-red-600 text-sm font-medium">
        Clear All
      </button>
      <button onClick={onSaveFilter} className="text-green-600 text-sm font-medium">
        💾 Save Filter
      </button>
    </div>
  );
}
```

---

## Edge Cases

- **No todos at all vs. no matches**: If the user's entire todo list is empty, show a distinct empty state ("You have no todos yet") rather than the filtered-empty state ("No todos match your filters"). The two must not share copy, or users will think filtering broke an otherwise-populated list.
- **Invalid date range**: `dueDateFrom > dueDateTo` — do not throw; `applyFilters` naturally returns an empty result since no due date can satisfy both bounds. Optionally show an inline hint ("From date is after To date") but do not block the filter from applying.
- **Tag filter referencing a deleted tag**: If the currently-selected `tagId` no longer exists in the user's tag list (e.g. deleted in another tab), treat it the same as `'all'` in the UI dropdown (reset silently) rather than filtering to zero results with no explanation.
- **Saved preset referencing a deleted tag**: Applying a preset whose `filters.tagId` points to a tag that was later deleted must not error — `applyFilters`'s tag step will simply match nothing (since no todo has that `tag.id`), or the app can detect the missing tag on apply and fall back that dimension to `'all'` with a toast. Prefer the fallback for a better UX; document interim graceful-degradation as the minimum bar.
- **Corrupted `localStorage` data**: `loadPresets()` wraps `JSON.parse` in try/catch and returns `[]` on any failure (invalid JSON, wrong shape, quota errors), so a corrupted key never crashes the app — it just presents as "no saved presets."
- **`localStorage` quota exceeded on save**: `savePreset` should catch a `QuotaExceededError` from `setItem` and surface a user-facing error ("Could not save preset — storage full") rather than losing the preset silently.
- **Empty search string with only whitespace**: `"   "` should behave identically to an empty search (trim before checking `hasActiveFilters` and before filtering).
- **Case sensitivity and unicode**: search must use `.toLowerCase()` consistently on both the query and the haystack; do not assume ASCII-only titles.
- **Large lists (1000+ todos)**: `applyFilters` must remain a single linear pass per filter step (no nested O(n²) scans) to hit the <100ms target; avoid re-running `applyFilters` on every keystroke by filtering against the **debounced** search value only.
- **Rapid preset apply followed by manual edit**: applying a preset must fully overwrite all five `FilterState` fields (including resetting ones the preset left at defaults), not merge with the current state, so stale filter values from before the apply don't linger.

---

## Acceptance Criteria

- [x] Search matches todo titles case-insensitively with partial matches.
- [x] Search also matches any subtask title belonging to a todo.
- [x] Search input is debounced by 300ms; clearing bypasses the debounce.
- [x] Priority quick filter shows only todos of the selected priority.
- [x] Tag quick filter (when tags exist) shows only todos with the selected tag.
- [x] Advanced panel toggles open/closed and visually indicates active/inactive state.
- [x] Completion status filter correctly separates incomplete vs. completed todos.
- [x] Due date range filter only matches todos that have a `due_date`, respecting independently-optional From/To bounds and Singapore calendar dates.
- [x] All active filters combine with AND logic in the order: search, priority, tag, completion, date range.
- [x] "Clear All" resets every filter dimension to its default in one click.
- [x] "Save Filter" is only visible when at least one filter is active, and shows an accurate preview of active filters before saving.
- [x] Saved presets persist across a page reload (via `localStorage`).
- [x] Applying a saved preset sets all five filter dimensions in one action.
- [x] Deleting a preset removes it from `localStorage` and from the UI immediately.
- [x] Section counters (Overdue/Pending/Completed) reflect post-filter counts; empty sections are hidden.
- [x] A distinct empty state is shown when filters produce zero results, versus when the user has zero todos.
- [x] Filtering 1000 todos completes in under 100ms.

---

## Testing Requirements

Test file: `tests/10-search-filtering.spec.ts`. Shared `tests/helpers.ts` provides `createTodo()`, `createTag()`, isolated account/checklist fixtures, and signed JWT sessions. `playwright.config.ts` sets `Asia/Singapore`. These tests do not claim to verify the not-yet-built WebAuthn flow.

### E2E tests (Playwright)

- [x] Search by todo title returns only matching todos.
- [x] Search by subtask title returns the parent todo.
- [x] Search is case-insensitive (`"MEETING"` matches `"Team meeting"`).
- [x] Clearing search immediately restores the full list.
- [x] Filtering by priority shows only that priority's todos.
- [x] Filtering by tag (after creating a tag and assigning it via `createTag()`/tag UI) shows only tagged todos.
- [x] Expanding "Advanced" reveals completion status and date range controls.
- [x] Completion status filter correctly isolates completed vs. incomplete todos.
- [x] Date range filter (`From` + `To`) shows only todos due within range.
- [x] Combining search + priority + tag + completion + date range narrows results to the AND intersection.
- [x] "Clear All" appears only when a filter is active and resets the view when clicked.
- [x] Saving a filter preset, reloading the page, and applying the preset reproduces the same filtered view.
- [x] Deleting a saved preset removes its pill and it no longer appears after reload.
- [x] Empty-result state renders when a filter combination matches nothing.
- [x] Deleted-tag fallback, quota errors, distinct empty accounts, shared refresh events and exact debounce timing.

### Unit tests

- [x] `applyFilters`: title/subtask search, no match, empty query and tag-name exclusion.
- [x] `applyFilters`: each priority and all priorities.
- [x] `applyFilters`: tag match, absent tag and all tags.
- [x] `applyFilters`: incomplete, completed and all statuses.
- [x] `applyFilters`: independent/both date bounds, null dates, invalid ranges and Singapore/UTC boundaries.
- [x] `applyFilters`: strict AND intersection and unchanged ordering.
- [x] `useDebounce` behavior is verified through deterministic Playwright clock tests: delayed updates, rapid typing and immediate clear (browser-level coverage rather than a separate hook unit harness).
- [x] Preset round-trip with mocked storage, malformed payloads, account isolation and quota failures.
- [x] `hasActiveFilters`: every dimension and all-default/whitespace states.

---

## Out of Scope

- Server-side or full-text search (e.g. SQLite FTS5) — all matching is client-side substring matching.
- Fuzzy or typo-tolerant search (e.g. Levenshtein distance, "did you mean").
- Cross-user or shared/synced saved filter presets — presets are local to one browser.
- Search history or query suggestions/autocomplete.
- Regular-expression or boolean search operators (`AND`/`OR`/`NOT` syntax in the query itself).
- Searching within tag names or template names (only todo titles and subtask titles are indexed).
- Sorting controls beyond the existing priority → due date → creation date default sort (filtering does not change sort order).

---

## Success Metrics

- Filter recomputation over 1000 todos completes in **under 100ms** on a mid-range laptop.
- Search input feels responsive: visible debounce delay of **300ms**, no dropped keystrokes.
- Zero false positives/negatives against the `applyFilters` unit test suite (100% pass rate is the acceptance bar, not an aspirational target).
- Saved presets survive a full page reload with 100% fidelity (all five `FilterState` fields restored exactly).
- No reported crashes from malformed `localStorage` data across a full QA pass (corrupted-JSON edge case is explicitly covered).
