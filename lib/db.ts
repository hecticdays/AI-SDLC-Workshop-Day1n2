import Database from 'better-sqlite3';
import { z } from 'zod';
import { getSingaporeNow, singaporeInstant } from './timezone';
import { parseTemplateSubtasks } from './progress';
export { parseTemplateSubtasks } from './progress';

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';

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
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface CreateTagInput {
  name: string;
  color?: string;
}

export type UpdateTagInput = Partial<CreateTagInput>;

export interface TemplateSubtask { title: string; position: number }
export interface Template {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
  created_at: string;
}

export class DataError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const tagInputSchema = z.object({
  name: z.string().trim().min(1, 'Tag name is required'),
  color: z.string().regex(/^#[\da-f]{6}$/i, 'Color must be a valid hex code').default('#3B82F6'),
}).strict();
export const tagUpdateSchema = tagInputSchema.extend({
  color: tagInputSchema.shape.color.removeDefault(),
}).partial().refine(
  (value) => Object.keys(value).length > 0, 'At least one field is required',
);
const titleSchema = z.string().trim().min(1, 'Title is required');
const recurrenceSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
const reminderSchema = z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120), z.literal(1440), z.literal(2880), z.literal(10080)]);
const draftSubtaskSchema = z.object({ title: titleSchema, position: z.number().int().nonnegative().optional() }).strict();
export const subtaskInputSchema = z.object({ title: titleSchema }).strict();
export const subtaskUpdateSchema = subtaskInputSchema.extend({ completed: z.boolean() }).partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const todoFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  tag_ids: z.array(z.number().int().positive()).default([]),
  due_date: z.string().refine((value) => Number.isFinite(singaporeInstant(value).getTime()), 'Invalid due date').nullable().default(null),
  is_recurring: z.boolean().default(false),
  recurrence_pattern: recurrenceSchema.nullable().default(null),
  reminder_minutes: reminderSchema.nullable().default(null),
  subtasks: z.array(draftSubtaskSchema).default([]),
}).strict();

function validSchedule(value: { is_recurring: boolean; recurrence_pattern: RecurrencePattern | null; reminder_minutes: number | null }, hasDate: boolean) {
  return (!value.is_recurring || (hasDate && value.recurrence_pattern !== null)) &&
    (value.is_recurring || value.recurrence_pattern === null) && (value.reminder_minutes === null || hasDate);
}
const scheduledTodoSchema = todoFieldsSchema.refine((value) => validSchedule(value, value.due_date !== null),
  'Recurrence requires a pattern and due date; reminders require a due date');
export const todoInputSchema = todoFieldsSchema.extend({
  due_date_offset_minutes: z.number().int().min(1).max(100_000_000).optional(),
}).refine((value) => value.due_date_offset_minutes === undefined || value.due_date === null,
  'Choose a due date or a relative offset, not both')
  .refine((value) => value.due_date_offset_minutes !== undefined || !value.due_date ||
    singaporeInstant(value.due_date).getTime() >= getSingaporeNow().getTime() + 60_000, 'Due date must be at least one minute in the future')
  .transform(({ due_date_offset_minutes, ...fields }) => ({ ...fields, due_date: due_date_offset_minutes === undefined ? fields.due_date :
    new Date(getSingaporeNow().getTime() + due_date_offset_minutes * 60_000).toISOString() }))
  .refine((value) => validSchedule(value, value.due_date !== null), 'Recurrence requires a pattern and due date; reminders require a due date');
export const todoUpdateSchema = todoFieldsSchema.omit({ subtasks: true }).extend({
  priority: todoFieldsSchema.shape.priority.removeDefault(),
  tag_ids: todoFieldsSchema.shape.tag_ids.removeDefault(),
  due_date: todoFieldsSchema.shape.due_date.removeDefault(),
  is_recurring: todoFieldsSchema.shape.is_recurring.removeDefault(),
  recurrence_pattern: todoFieldsSchema.shape.recurrence_pattern.removeDefault(),
  reminder_minutes: todoFieldsSchema.shape.reminder_minutes.removeDefault(),
}).partial().extend({ completed: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const templateFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Template name is required'),
  description: z.string().trim().nullable().default(null),
  category: z.string().trim().nullable().default(null),
  title_template: titleSchema,
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  is_recurring: z.boolean().default(false),
  recurrence_pattern: recurrenceSchema.nullable().default(null),
  reminder_minutes: reminderSchema.nullable().default(null),
  due_date_offset_minutes: z.number().int().min(1).max(100_000_000).nullable().default(null),
  subtasks: z.array(draftSubtaskSchema).default([]),
}).strict();
export const templateInputSchema = templateFieldsSchema.refine((value) => validSchedule(value, value.due_date_offset_minutes !== null),
  'Recurrence requires a pattern and date offset; reminders require a date offset');
export const templateUpdateSchema = templateFieldsSchema.extend({
  description: templateFieldsSchema.shape.description.removeDefault(),
  category: templateFieldsSchema.shape.category.removeDefault(),
  priority: templateFieldsSchema.shape.priority.removeDefault(),
  is_recurring: templateFieldsSchema.shape.is_recurring.removeDefault(),
  recurrence_pattern: templateFieldsSchema.shape.recurrence_pattern.removeDefault(),
  reminder_minutes: templateFieldsSchema.shape.reminder_minutes.removeDefault(),
  due_date_offset_minutes: templateFieldsSchema.shape.due_date_offset_minutes.removeDefault(),
  subtasks: templateFieldsSchema.shape.subtasks.removeDefault(),
}).partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export type CreateSubtaskDto = z.input<typeof subtaskInputSchema>;
export type UpdateSubtaskDto = z.input<typeof subtaskUpdateSchema>;
export type CreateTemplateDto = z.input<typeof templateInputSchema>;

export function createStore(database: Database.Database) {
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, due_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium', is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT, reminder_minutes INTEGER, last_notification_sent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT COLLATE NOCASE NOT NULL, color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, name)
    );
    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(todo_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
    CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT, category TEXT, title_template TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium', is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT, reminder_minutes INTEGER, due_date_offset_minutes INTEGER, subtasks_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_templates_user_id ON templates(user_id);
  `);

  function requireTodo(id: number, userId: number) {
    if (!database.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(id, userId)) {
      throw new DataError('Todo not found', 404);
    }
  }

  function findSubtask(id: number, userId: number): Subtask {
    const row = database.prepare(`SELECT subtasks.* FROM subtasks JOIN todos ON todos.id = subtasks.todo_id
      WHERE subtasks.id = ? AND todos.user_id = ?`).get(id, userId) as Subtask | undefined;
    if (!row) throw new DataError('Subtask not found', 404);
    return { ...row, completed: Boolean(row.completed) };
  }

  const subtasks = {
    findByTodoId(todoId: number, userId: number): Subtask[] {
      requireTodo(todoId, userId);
      const rows = database.prepare('SELECT * FROM subtasks WHERE todo_id = ? ORDER BY position, id').all(todoId) as Subtask[];
      return rows.map((row) => ({ ...row, completed: Boolean(row.completed) }));
    },
    create(todoId: number, userId: number, input: CreateSubtaskDto): Subtask {
      requireTodo(todoId, userId);
      const parsed = subtaskInputSchema.parse(input);
      return database.transaction(() => {
        const result = database.prepare(`INSERT INTO subtasks(todo_id, title, position)
          SELECT ?, ?, COALESCE(MAX(position), -1) + 1 FROM subtasks WHERE todo_id = ?`).run(todoId, parsed.title, todoId);
        return findSubtask(Number(result.lastInsertRowid), userId);
      })();
    },
    update(id: number, userId: number, input: UpdateSubtaskDto): Subtask {
      const row = findSubtask(id, userId);
      const parsed = subtaskUpdateSchema.parse(input);
      database.prepare('UPDATE subtasks SET title = ?, completed = ? WHERE id = ?')
        .run(parsed.title ?? row.title, Number(parsed.completed ?? row.completed), id);
      return findSubtask(id, userId);
    },
    delete(id: number, userId: number) {
      findSubtask(id, userId);
      database.prepare('DELETE FROM subtasks WHERE id = ?').run(id);
    },
  };

  const findTag = (id: number, userId: number) => database.prepare(
    'SELECT * FROM tags WHERE id = ? AND user_id = ?',
  ).get(id, userId) as Tag | undefined;

  function requireRelations(todoId: number, tagId: number, userId: number) {
    if (!database.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(todoId, userId) || !findTag(tagId, userId)) {
      throw new DataError('Todo or tag not found', 404);
    }
  }

  function uniqueError(error: unknown): never {
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new DataError('A tag with this name already exists', 409);
    }
    throw error;
  }

  const tags = {
    findAllByUser(userId: number): Tag[] {
      return database.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE, id').all(userId) as Tag[];
    },
    findById: findTag,
    findByName(name: string, userId: number): Tag | undefined {
      const trimmed = tagInputSchema.shape.name.parse(name);
      return database.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1')
        .get(userId, trimmed) as Tag | undefined;
    },
    findOrCreateByName(userId: number, input: CreateTagInput): { tag: Tag; created: boolean } {
      const parsed = tagInputSchema.parse(input);
      return database.transaction(() => {
        const existing = tags.findByName(parsed.name, userId);
        return existing ? { tag: existing, created: false } : { tag: tags.create(userId, parsed), created: true };
      })();
    },
    create(userId: number, input: CreateTagInput): Tag {
      const parsed = tagInputSchema.parse(input);
      try {
        const result = database.prepare('INSERT INTO tags(user_id, name, color) VALUES (?, ?, ?)').run(userId, parsed.name, parsed.color);
        return findTag(Number(result.lastInsertRowid), userId)!;
      } catch (error) {
        return uniqueError(error);
      }
    },
    update(id: number, userId: number, input: UpdateTagInput): Tag {
      const existing = findTag(id, userId);
      if (!existing) throw new DataError('Tag not found', 404);
      const parsed = tagUpdateSchema.parse(input);
      try {
        database.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND user_id = ?')
          .run(parsed.name ?? existing.name, parsed.color ?? existing.color, id, userId);
        return findTag(id, userId)!;
      } catch (error) {
        return uniqueError(error);
      }
    },
    delete(id: number, userId: number) {
      const result = database.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, userId);
      if (!result.changes) throw new DataError('Tag not found', 404);
    },
    attachToTodo(todoId: number, tagId: number, userId: number) {
      database.transaction(() => {
        requireRelations(todoId, tagId, userId);
        database.prepare('INSERT INTO todo_tags(todo_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(todoId, tagId);
      })();
    },
    detachFromTodo(todoId: number, tagId: number, userId: number) {
      database.transaction(() => {
        requireRelations(todoId, tagId, userId);
        database.prepare('DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?').run(todoId, tagId);
      })();
    },
    replaceForTodo(todoId: number, tagIds: number[], userId: number): Tag[] {
      const ids = [...new Set(z.array(z.number().int().positive()).parse(tagIds))];
      return database.transaction(() => {
        if (!database.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(todoId, userId)) {
          throw new DataError('Todo not found', 404);
        }
        for (const tagId of ids) requireRelations(todoId, tagId, userId);
        database.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
        const insert = database.prepare('INSERT INTO todo_tags(todo_id, tag_id) VALUES (?, ?)');
        for (const tagId of ids) insert.run(todoId, tagId);
        return tags.findByTodoId(todoId, userId);
      })();
    },
    findByTodoId(todoId: number, userId: number): Tag[] {
      return database.prepare(`SELECT tags.* FROM tags
        JOIN todo_tags ON tags.id = todo_tags.tag_id JOIN todos ON todos.id = todo_tags.todo_id
        WHERE todos.id = ? AND todos.user_id = ? AND tags.user_id = ? ORDER BY tags.name COLLATE NOCASE`)
        .all(todoId, userId, userId) as Tag[];
    },
  };

  const todos = {
    findAllByUser(userId: number): Todo[] {
      const rows = database.prepare(`SELECT * FROM todos WHERE user_id = ?
        ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        due_date IS NULL, due_date, created_at DESC, id DESC`).all(userId) as Todo[];
      const tagRows = database.prepare(`SELECT tags.*, todo_tags.todo_id FROM tags
        JOIN todo_tags ON tags.id = todo_tags.tag_id JOIN todos ON todos.id = todo_tags.todo_id
        WHERE todos.user_id = ? AND tags.user_id = ? ORDER BY tags.name COLLATE NOCASE`).all(userId, userId) as (Tag & { todo_id: number })[];
      const subtaskRows = database.prepare(`SELECT subtasks.* FROM subtasks JOIN todos ON todos.id = subtasks.todo_id
        WHERE todos.user_id = ? ORDER BY subtasks.position, subtasks.id`).all(userId) as Subtask[];
      const tagsByTodo = new Map<number, Tag[]>();
      const subtasksByTodo = new Map<number, Subtask[]>();
      for (const { todo_id, ...tag } of tagRows) tagsByTodo.set(todo_id, [...(tagsByTodo.get(todo_id) ?? []), tag]);
      for (const subtask of subtaskRows) subtasksByTodo.set(subtask.todo_id, [...(subtasksByTodo.get(subtask.todo_id) ?? []), { ...subtask, completed: Boolean(subtask.completed) }]);
      return rows.map((row) => ({ ...row, completed: Boolean(row.completed), is_recurring: Boolean(row.is_recurring),
        tags: tagsByTodo.get(row.id) ?? [], subtasks: subtasksByTodo.get(row.id) ?? [] }));
    },
    findById(id: number, userId: number): Todo | undefined {
      return todos.findAllByUser(userId).find((row) => row.id === id);
    },
    create(userId: number, input: z.input<typeof todoInputSchema>): Todo {
      return insertTodo(userId, todoInputSchema.parse(input));
    },
    update(id: number, userId: number, input: z.input<typeof todoUpdateSchema>): Todo {
      requireTodo(id, userId);
      const parsed = todoUpdateSchema.parse(input);
      const existing = todos.findById(id, userId)!;
      const next = { ...existing, ...parsed };
      if (!validSchedule(next, next.due_date !== null)) throw new DataError('Invalid recurrence or reminder schedule', 400);
      if (parsed.due_date && singaporeInstant(parsed.due_date).getTime() < getSingaporeNow().getTime() + 60_000) {
        throw new DataError('Due date must be at least one minute in the future', 400);
      }
      return database.transaction(() => {
        database.prepare(`UPDATE todos SET title = ?, priority = ?, completed = ?, due_date = ?, is_recurring = ?,
          recurrence_pattern = ?, reminder_minutes = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
          .run(next.title, next.priority, Number(next.completed), next.due_date ? singaporeInstant(next.due_date).toISOString() : null,
            Number(next.is_recurring), next.recurrence_pattern, next.reminder_minutes, getSingaporeNow().toISOString(), id, userId);
        if (parsed.tag_ids !== undefined) tags.replaceForTodo(id, parsed.tag_ids, userId);
        return todos.findById(id, userId)!;
      })();
    },
    delete(id: number, userId: number) {
      requireTodo(id, userId);
      database.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId);
    },
  };

  function insertTodo(userId: number, parsed: z.output<typeof todoFieldsSchema>): Todo {
    return database.transaction(() => {
      const result = database.prepare(`INSERT INTO todos(user_id, title, priority, due_date, is_recurring, recurrence_pattern, reminder_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, parsed.title, parsed.priority,
        parsed.due_date ? singaporeInstant(parsed.due_date).toISOString() : null,
        Number(parsed.is_recurring), parsed.recurrence_pattern, parsed.reminder_minutes);
      const id = Number(result.lastInsertRowid);
      tags.replaceForTodo(id, parsed.tag_ids, userId);
      const children = parsed.subtasks.map((child, index) => ({ ...child, position: child.position ?? index }));
      for (const child of children) {
        database.prepare('INSERT INTO subtasks(todo_id, title, position) VALUES (?, ?, ?)').run(id, child.title, child.position);
      }
      return todos.findById(id, userId)!;
    })();
  }

  function findTemplate(id: number, userId: number): Template | undefined {
    const row = database.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, userId) as Template | undefined;
    return row ? { ...row, is_recurring: Boolean(row.is_recurring) } : undefined;
  }

  function requireTemplate(id: number, userId: number): Template {
    const row = findTemplate(id, userId);
    if (!row) throw new DataError('Template not found', 404);
    return row;
  }

  function templateValues(parsed: z.output<typeof templateInputSchema>) {
    return [parsed.name, parsed.description, parsed.category, parsed.title_template, parsed.priority, Number(parsed.is_recurring),
      parsed.recurrence_pattern, parsed.reminder_minutes, parsed.due_date_offset_minutes,
      JSON.stringify(parsed.subtasks.map((child, index) => ({ title: child.title, position: child.position ?? index })))];
  }

  const templates = {
    findById: findTemplate,
    findAllByUser(userId: number): Template[] {
      const rows = database.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY name COLLATE NOCASE, id').all(userId) as Template[];
      return rows.map((row) => ({ ...row, is_recurring: Boolean(row.is_recurring) }));
    },
    create(userId: number, input: CreateTemplateDto): Template {
      const parsed = templateInputSchema.parse(input);
      const result = database.prepare(`INSERT INTO templates(user_id, name, description, category, title_template, priority,
        is_recurring, recurrence_pattern, reminder_minutes, due_date_offset_minutes, subtasks_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(userId, ...templateValues(parsed));
      return requireTemplate(Number(result.lastInsertRowid), userId);
    },
    update(id: number, userId: number, input: z.input<typeof templateUpdateSchema>): Template {
      const existing = requireTemplate(id, userId);
      const patch = templateUpdateSchema.parse(input);
      const fields = templateFieldsSchema.omit({ subtasks: true }).strip().parse(existing);
      const parsed = templateInputSchema.parse({ ...fields, subtasks: parseTemplateSubtasks(existing.subtasks_json), ...patch });
      database.prepare(`UPDATE templates SET name = ?, description = ?, category = ?, title_template = ?, priority = ?,
        is_recurring = ?, recurrence_pattern = ?, reminder_minutes = ?, due_date_offset_minutes = ?, subtasks_json = ?
        WHERE id = ? AND user_id = ?`).run(...templateValues(parsed), id, userId);
      return requireTemplate(id, userId);
    },
    delete(id: number, userId: number) {
      requireTemplate(id, userId);
      database.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId);
    },
    use(id: number, userId: number): Todo {
      return database.transaction(() => {
        const row = requireTemplate(id, userId);
        const fields = templateFieldsSchema.omit({ subtasks: true }).strip().parse(row);
        const parsed = templateInputSchema.parse({ ...fields, subtasks: parseTemplateSubtasks(row.subtasks_json) });
        const due = parsed.due_date_offset_minutes === null ? null :
          new Date(getSingaporeNow().getTime() + parsed.due_date_offset_minutes * 60_000).toISOString();
        return insertTodo(userId, scheduledTodoSchema.parse({ title: parsed.title_template, priority: parsed.priority,
          due_date: due, is_recurring: parsed.is_recurring, recurrence_pattern: parsed.recurrence_pattern,
          reminder_minutes: parsed.reminder_minutes, subtasks: parsed.subtasks }));
      })();
    },
  };
  return { tags, todos, subtasks, templates };
}

export function demoEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEMO_MODE === 'true' && process.env.DATABASE_PATH === 'demo.db';
}

function seedDemo(database: Database.Database, store: ReturnType<typeof createStore>) {
  database.transaction(() => {
    database.prepare("INSERT INTO users(username) VALUES ('Workshop demo') ON CONFLICT DO NOTHING").run();
    const user = database.prepare("SELECT id FROM users WHERE username = 'Workshop demo'").get() as { id: number };
    if (database.prepare('SELECT id FROM todos WHERE user_id = ? LIMIT 1').get(user.id)) return;
    const work = store.tags.create(user.id, { name: 'Work', color: '#2563EB' });
    const personal = store.tags.create(user.id, { name: 'Personal', color: '#0F766E' });
    const study = store.tags.create(user.id, { name: 'Study', color: '#BE185D' });
    const now = getSingaporeNow();
    const fixtures = [
      { title: 'Review the release checklist', priority: 'high' as const, tags: [work.id], days: -1, completed: false, subtask: 'Confirm accessibility checks' },
      { title: 'Prepare workshop presentation', priority: 'high' as const, tags: [work.id, study.id], days: 0, completed: false, subtask: 'Collect team feedback' },
      { title: 'Book the weekend cycling route', priority: 'medium' as const, tags: [personal.id], days: 2, completed: false, subtask: 'Check the weather forecast' },
      { title: 'Read about passkey security', priority: 'medium' as const, tags: [study.id], days: 4, completed: false, subtask: 'Compare authenticator types' },
      { title: 'Organize project notes', priority: 'low' as const, tags: [work.id], days: null, completed: false, subtask: 'Archive old decisions' },
      { title: 'Submit the requirements review', priority: 'high' as const, tags: [study.id], days: -2, completed: true, subtask: 'Share findings with the team' },
    ];
    for (const fixture of fixtures) {
      const row = store.todos.create(user.id, { title: fixture.title, priority: fixture.priority, tag_ids: fixture.tags });
      const due = fixture.days === null ? null : new Date(now.getTime() + fixture.days * 86_400_000).toISOString();
      database.prepare('UPDATE todos SET due_date = ?, completed = ? WHERE id = ?').run(due, Number(fixture.completed), row.id);
      database.prepare('INSERT INTO subtasks(todo_id, title, completed) VALUES (?, ?, ?)').run(row.id, fixture.subtask, Number(fixture.completed));
    }
  })();
}

const databaseGlobal = globalThis as typeof globalThis & { workshopDatabase?: Database.Database };
export function getDatabase(): Database.Database {
  if (!databaseGlobal.workshopDatabase) {
    const database = new Database(process.env.DATABASE_PATH ?? 'todos.db');
    database.pragma('journal_mode = WAL');
    const store = createStore(database);
    if (demoEnabled()) seedDemo(database, store);
    databaseGlobal.workshopDatabase = database;
  }
  return databaseGlobal.workshopDatabase;
}

let cachedStore: ReturnType<typeof createStore> | undefined;
export function getStore() {
  return cachedStore ??= createStore(getDatabase());
}
export const tagDB = new Proxy({} as ReturnType<typeof createStore>['tags'], {
  get: (_target, property: keyof ReturnType<typeof createStore>['tags']) => getStore().tags[property],
});
export const todoDB = new Proxy({} as ReturnType<typeof createStore>['todos'], {
  get: (_target, property: keyof ReturnType<typeof createStore>['todos']) => getStore().todos[property],
});
export const subtaskDB = new Proxy({} as ReturnType<typeof createStore>['subtasks'], {
  get: (_target, property: keyof ReturnType<typeof createStore>['subtasks']) => getStore().subtasks[property],
});
export const templateDB = new Proxy({} as ReturnType<typeof createStore>['templates'], {
  get: (_target, property: keyof ReturnType<typeof createStore>['templates']) => getStore().templates[property],
});