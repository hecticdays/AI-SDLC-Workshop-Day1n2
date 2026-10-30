import type Database from 'better-sqlite3';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import { createStore, type Todo } from './db';
import { formatSingaporeDate, getSingaporeNow, singaporeInstant } from './timezone';

const timestampSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
]).refine((value) => Number.isFinite(singaporeInstant(value).getTime()), 'Invalid timestamp');
const titleSchema = z.string().trim().min(1);
const reminderSchema = z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120),
  z.literal(1440), z.literal(2880), z.literal(10080)]);
const itemSchema = z.object({
  title: titleSchema,
  completed: z.boolean(),
  due_date: z.iso.datetime({ offset: true }).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  is_recurring: z.boolean(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
  reminder_minutes: reminderSchema.nullable(),
  created_at: timestampSchema,
  subtasks: z.array(z.object({ title: titleSchema, completed: z.boolean(), position: z.number().int() }).strict()),
  tags: z.array(z.object({ name: titleSchema, color: z.string().regex(/^#[\da-f]{6}$/i) }).strict()),
}).strict().refine((item) => (!item.is_recurring || (item.due_date !== null && item.recurrence_pattern !== null)) &&
  (item.is_recurring || item.recurrence_pattern === null) && (item.reminder_minutes === null || item.due_date !== null),
'Invalid recurrence or reminder settings');

export const importSchema = z.object({ version: z.literal(1), exported_at: timestampSchema, todos: z.array(itemSchema) }).strict();
export type TodoExport = z.infer<typeof importSchema>;
export interface ImportResult { imported: number; tagsCreated: number; tagsReused: number }

export function exportFilename(format: 'json' | 'csv', now = getSingaporeNow()): string {
  return `todos-${formatSingaporeDate(now, 'yyyy-MM-dd')}.${format}`;
}

export function toCsv(todos: Todo[]): string {
  const rows = todos.map((todo) => [todo.id, todo.title, todo.completed, todo.due_date ?? '', todo.priority,
    todo.is_recurring, todo.recurrence_pattern ?? '', todo.reminder_minutes ?? '']);
  return stringify(rows, { header: true, columns: ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'],
    escape_formulas: true, record_delimiter: '\r\n', cast: { boolean: (value) => String(value) } });
}

export function createPortability(database: Database.Database) {
  const store = createStore(database);

  function exportAll(userId: number): TodoExport {
    return {
      version: 1,
      exported_at: formatSingaporeDate(getSingaporeNow(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
      todos: store.todos.findAllByUser(userId).map((todo) => ({
        title: todo.title, completed: todo.completed, due_date: todo.due_date, priority: todo.priority,
        is_recurring: todo.is_recurring, recurrence_pattern: todo.recurrence_pattern,
        reminder_minutes: reminderSchema.nullable().parse(todo.reminder_minutes), created_at: todo.created_at,
        subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({ title, completed, position })),
        tags: (todo.tags ?? []).map(({ name, color }) => ({ name, color })),
      })),
    };
  }

  function importAll(userId: number, input: unknown): ImportResult {
    const parsed = importSchema.parse(input);
    return database.transaction(() => {
      let createdTags: number[] = [];
      let reusedTags: number[] = [];
      const insertTodo = database.prepare(`INSERT INTO todos
        (user_id, title, completed, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes, created_at, last_notification_sent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
      const insertSubtask = database.prepare('INSERT INTO subtasks(todo_id, title, completed, position) VALUES (?, ?, ?, ?)');
      for (const item of parsed.todos) {
        const dueDate = item.due_date === null ? null : singaporeInstant(item.due_date).toISOString();
        const result = insertTodo.run(userId, item.title, Number(item.completed), dueDate, item.priority,
          Number(item.is_recurring), item.recurrence_pattern, item.reminder_minutes, item.created_at);
        const todoId = Number(result.lastInsertRowid);
        item.subtasks.forEach((subtask, position) => insertSubtask.run(todoId, subtask.title, Number(subtask.completed), position));
        const tagIds = item.tags.map((inputTag) => {
          const { tag, created } = store.tags.findOrCreateByName(userId, inputTag);
          if (created) createdTags = [...createdTags, tag.id];
          else if (!createdTags.includes(tag.id)) reusedTags = [...reusedTags, tag.id];
          return tag.id;
        });
        store.tags.replaceForTodo(todoId, tagIds, userId);
      }
      return { imported: parsed.todos.length, tagsCreated: new Set(createdTags).size, tagsReused: new Set(reusedTags).size };
    })();
  }

  return { exportAll, importAll };
}