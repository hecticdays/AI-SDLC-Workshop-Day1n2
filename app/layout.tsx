import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daybook | Tasks',
  description: 'Personal tasks, tags, and saved views.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}