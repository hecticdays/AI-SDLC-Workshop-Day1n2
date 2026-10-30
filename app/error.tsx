'use client';

import Link from 'next/link';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="status-page" role="alert">
    <p className="eyebrow">500</p>
    <h1>Something went wrong</h1>
    <p>An unexpected error occurred. Your saved tasks are safe; please try again.</p>
    <div className="status-actions"><button type="button" className="secondary-button" onClick={reset}>Try again</button><Link className="secondary-button" href="/">Back to tasks</Link></div>
  </main>;
}
