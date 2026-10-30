import { z } from 'zod';
import type { Todo } from './db';
import { formatSingaporeDate } from './timezone';

const calendarDate = z.iso.date().nullable();
export const filterSchema = z.object({
  search: z.string(),
  priority: z.enum(['all', 'high', 'medium', 'low']),
  tagId: z.union([z.literal('all'), z.number().int().positive()]),
  completion: z.enum(['all', 'incomplete', 'completed']),
  dueDateFrom: calendarDate,
  dueDateTo: calendarDate,
});

export type FilterState = z.infer<typeof filterSchema>;
export const DEFAULT_FILTER_STATE: FilterState = {
  search: '', priority: 'all', tagId: 'all', completion: 'all',
  dueDateFrom: null, dueDateTo: null,
};

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.search.trim() !== '' || filters.priority !== 'all' ||
    filters.tagId !== 'all' || filters.completion !== 'all' ||
    filters.dueDateFrom !== null || filters.dueDateTo !== null;
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  const query = filters.search.trim().toLowerCase();
  return todos.filter((todo) => {
    if (query && !todo.title.toLowerCase().includes(query) &&
      !(todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query))) return false;
    if (filters.priority !== 'all' && todo.priority !== filters.priority) return false;
    if (filters.tagId !== 'all' && !(todo.tags ?? []).some((tag) => tag.id === filters.tagId)) return false;
    if (filters.completion === 'incomplete' && todo.completed) return false;
    if (filters.completion === 'completed' && !todo.completed) return false;
    if (filters.dueDateFrom || filters.dueDateTo) {
      if (!todo.due_date) return false;
      try {
        const due = formatSingaporeDate(todo.due_date);
        if (filters.dueDateFrom && due < filters.dueDateFrom) return false;
        if (filters.dueDateTo && due > filters.dueDateTo) return false;
      } catch {
        return false;
      }
    }
    return true;
  });
}

export const presetSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1),
  filters: filterSchema, createdAt: z.iso.datetime(),
});
export type FilterPreset = z.infer<typeof presetSchema>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const PRESETS_KEY = 'todo-app:filter-presets';

export function loadPresets(userId: number, storage?: StoragePort): FilterPreset[] {
  try {
    const raw = (storage ?? localStorage).getItem(`${PRESETS_KEY}:${userId}`);
    if (!raw) return [];
    const parsed = z.array(presetSchema).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writePresets(userId: number, presets: FilterPreset[], storage?: StoragePort): FilterPreset[] {
  try {
    (storage ?? localStorage).setItem(`${PRESETS_KEY}:${userId}`, JSON.stringify(presets));
    return presets;
  } catch {
    throw new Error('Could not save preset. Browser storage is full or unavailable.');
  }
}

export function savePreset(userId: number, preset: FilterPreset, storage?: StoragePort): FilterPreset[] {
  return writePresets(userId, [...loadPresets(userId, storage), presetSchema.parse(preset)], storage);
}

export function deletePreset(userId: number, id: string, storage?: StoragePort): FilterPreset[] {
  return writePresets(userId, loadPresets(userId, storage).filter((preset) => preset.id !== id), storage);
}