export function isDueDateAtLeastOneMinuteAhead(value: string | null | undefined, now = new Date()): boolean {
  if (value == null) return true;
  const due = Date.parse(value);
  return Number.isFinite(due) && due >= now.getTime() + 60_000;
}