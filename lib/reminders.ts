export const REMINDER_LABELS: Readonly<Record<number, string>> = {
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  1440: '1d',
  2880: '2d',
  10080: '1w',
};

export function reminderLabel(minutes: number): string {
  return REMINDER_LABELS[minutes] ?? `${minutes}m`;
}
