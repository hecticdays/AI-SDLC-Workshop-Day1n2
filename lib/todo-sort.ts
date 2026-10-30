export type Priority = 'high' | 'medium' | 'low';

export interface SortableTodo {
  priority: Priority;
  due_date: string | null;
  created_at: string;
}

const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function sortTodos<T extends SortableTodo>(todos: T[]): T[] {
  return [...todos].sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function sectionTodos<T extends SortableTodo & { completed: boolean }>(todos: T[], now = new Date()) {
  const overdue: T[] = [];
  const pending: T[] = [];
  const completed: T[] = [];

  for (const todo of todos) {
    if (todo.completed) completed.push(todo);
    else if (todo.due_date && new Date(todo.due_date).getTime() < now.getTime()) overdue.push(todo);
    else pending.push(todo);
  }

  return {
    overdue: sortTodos(overdue),
    pending: sortTodos(pending),
    completed: sortTodos(completed),
  };
}