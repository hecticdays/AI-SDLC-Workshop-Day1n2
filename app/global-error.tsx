'use client';

import './globals.css';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body>
    <main className="status-page" role="alert">
      <p className="eyebrow">500</p>
      <h1>Something went wrong</h1>
      <p>The application failed to load. Please try again.</p>
      <div className="status-actions"><button type="button" className="secondary-button" onClick={reset}>Try again</button></div>
    </main>
  </body></html>;
}
