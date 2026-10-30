'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileSpreadsheet, LoaderCircle, Upload } from 'lucide-react';
import type { ImportResult } from '@/lib/portability';

export default function PortabilityControls({ onImported }: { onImported: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function download(format: 'json' | 'csv') {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/todos/export?format=${format}`, { cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Export failed');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `todos.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (failure) { setMessage({ error: true, text: (failure as Error).message }); }
    finally { setBusy(false); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setMessage(file.size > 10 * 1024 * 1024 ? { error: false, text: 'Large import in progress; this may take a while.' } : null);
    try {
      const body: unknown = JSON.parse(await file.text());
      const response = await fetch('/api/todos/import', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as ImportResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Import failed');
      setMessage({ error: false, text: `Successfully imported ${result.imported} todos` });
      await onImported();
    } catch (failure) {
      setMessage({ error: true, text: failure instanceof SyntaxError ? 'Invalid JSON format' : (failure as Error).message });
    } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  return <section aria-label="Export and import" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 18 }}>
    <button className="button secondary" disabled={busy} onClick={() => void download('json')}><Download size={16} />Export JSON</button>
    <button className="button secondary" disabled={busy} onClick={() => void download('csv')}><FileSpreadsheet size={16} />Export CSV</button>
    <button className="button secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}Import</button>
    <input ref={input} hidden type="file" aria-label="Import JSON file" accept="application/json,.json" onChange={(event) => void upload(event)} />
    {message && <p className={message.error ? 'error-banner' : 'muted'} role={message.error ? 'alert' : 'status'} style={{ flexBasis: '100%', margin: 0 }}>{message.text}</p>}
  </section>;
}