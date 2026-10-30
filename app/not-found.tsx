import Link from 'next/link';

export default function NotFound() {
  return <main className="status-page">
    <p className="eyebrow">404</p>
    <h1>Page not found</h1>
    <p>The page you are looking for does not exist or has moved.</p>
    <div className="status-actions"><Link className="secondary-button" href="/">Back to tasks</Link><Link className="secondary-button" href="/calendar">Open calendar</Link></div>
  </main>;
}
