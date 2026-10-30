import { z } from 'zod';

export const prioritySchema = z.enum(['high', 'medium', 'low']);

const dueDateSchema = z.string().datetime({ offset: true }).nullable().optional();

export const todoCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  due_date: dueDateSchema,
  priority: prioritySchema.optional().default('medium'),
  is_recurring: z.boolean().optional().default(false),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: z.number().int().min(0).nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional().default([]),
}).strict();

export const todoUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title cannot be empty').optional(),
  due_date: dueDateSchema,
  priority: prioritySchema.optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: z.number().int().min(0).nullable().optional(),
  completed: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export function isDueDateAtLeastOneMinuteAhead(value: string | null | undefined, now = new Date()): boolean {
  if (value == null) return true;
  const due = Date.parse(value);
  return Number.isFinite(due) && due >= now.getTime() + 60_000;
}