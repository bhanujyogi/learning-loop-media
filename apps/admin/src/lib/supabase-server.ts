import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side Supabase client acting AS THE SIGNED-IN STAFF USER (anon key + user JWT cookie).
 * Authorization is enforced by Postgres RLS/permissions — the admin app has no service-role key and no
 * frontend-only role checks. UI gating below is a convenience, never the security boundary.
 */
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (all) => {
          try {
            all.forEach(({ name, value, options }) => jar.set(name, value, options));
          } catch {
            /* called from a Server Component: refresh handled by proxy.ts */
          }
        },
      },
    },
  );
}

export interface StaffContext {
  userId: string;
  email: string | undefined;
  permissions: Set<string>;
}

export async function requireStaff(permission?: string): Promise<StaffContext> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect('/login');
  const roles = await sb.from('user_roles').select('role').eq('user_id', data.user.id);
  const names = (roles.data ?? []).map((r) => r.role);
  const perms = names.length
    ? await sb.from('role_permissions').select('permission').in('role', names)
    : { data: [] as { permission: string }[] };
  const permissions = new Set((perms.data ?? []).map((p) => p.permission));
  if (permissions.size === 0 || (permission && !permissions.has(permission)))
    redirect('/forbidden');
  return { userId: data.user.id, email: data.user.email, permissions };
}
