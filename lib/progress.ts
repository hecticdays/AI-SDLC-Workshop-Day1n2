export function calculateProgress(subtasks: readonly { readonly completed: boolean }[]) {
  const total = subtasks.length;
  const completed = subtasks.filter((subtask) => subtask.completed).length;
  return { completed, total, percent: total === 0 ? 0 : Math.round(completed / total * 100) };
}

export function parseTemplateSubtasks(value: string | null): { title: string; position: number }[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const child = item as Record<string, unknown>;
      return typeof child.title === 'string' && child.title.trim().length > 0 &&
        typeof child.position === 'number' && Number.isSafeInteger(child.position) && child.position >= 0;
    })) return [];
    return parsed.map((item: { title: string; position: number }) => ({ title: item.title.trim(), position: item.position }));
  } catch { return []; }
}