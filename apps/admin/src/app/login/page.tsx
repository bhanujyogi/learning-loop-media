import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  async function signIn(form: FormData) {
    'use server';
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithPassword({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    if (error) redirect('/login?error=1'); // generic: never reveal which part was wrong
    redirect('/');
  }
  return (
    <main style={{ margin: '80px auto', maxWidth: 360 }}>
      <h1>Learning Loop Admin</h1>
      <form action={signIn} style={{ display: 'grid', gap: 12 }} className="card">
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            style={{ width: '100%' }}
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            style={{ width: '100%' }}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)' }}>
            Sign-in failed.
          </p>
        ) : null}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
