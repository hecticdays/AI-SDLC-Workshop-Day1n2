const singaporeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function getSingaporeNow(): Date {
  return new Date();
}

export function formatSingaporeDate(date: Date, format: 'YYYY-MM-DD' | 'YYYY-MM'): string {
  const parts = Object.fromEntries(
    singaporeFormatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  const month = parts.month;
  return format === 'YYYY-MM' ? `${parts.year}-${month}` : `${parts.year}-${month}-${parts.day}`;
}

export function formatSingaporeDateTime(date: string): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}