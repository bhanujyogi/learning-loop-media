import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff, supabaseServer } from '@/lib/supabase-server';

const NAV: { href: string; label: string; perm?: string }[] = [
  { href: '/', label: 'Overview' },
  { href: '/moderation', label: 'Moderation', perm: 'moderation.review' },
  { href: '/content', label: 'Content', perm: 'moderation.review' },
  { href: '/sources', label: 'Sources', perm: 'sources.manage' },
  { href: '/pipeline', label: 'Pipeline jobs', perm: 'pipeline.run' },
  { href: '/recommendations', label: 'Recommendations', perm: 'analytics.read' },
  { href: '/experiments', label: 'Experiments', perm: 'experiments.manage' },
  { href: '/audit', label: 'Audit log', perm: 'audit.read' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  async function signOut() {
    'use server';
    await (await supabaseServer()).auth.signOut();
    redirect('/login');
  }
  return (
    <div className="shell">
      <nav aria-label="Admin">
        <strong style={{ padding: '8px 12px' }}>Learning Loop</strong>
        {NAV.filter((n) => !n.perm || staff.permissions.has(n.perm)).map((n) => (
          <Link key={n.href} href={n.href}>
            {n.label}
          </Link>
        ))}
        <span className="muted" style={{ padding: '8px 12px', marginTop: 'auto' }}>
          {staff.email}
        </span>
        <form action={signOut}>
          <button className="secondary" type="submit" style={{ width: '100%' }}>
            Sign out
          </button>
        </form>
      </nav>
      <main>{children}</main>
    </div>
  );
}
