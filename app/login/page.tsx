import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { PasskeyAuth } from '@/components/passkey-auth';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return <PasskeyAuth />;
}