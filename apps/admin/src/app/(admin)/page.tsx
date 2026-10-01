import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  await requireStaff();
  const sb = await supabaseServer();
  const n = (r: { count: number | null; error: unknown }) => (r.error ? null : (r.count ?? 0));
  const head = { count: 'exact', head: true } as const;
  const [users, content, openReports, queued] = await Promise.all([
    sb.from('profiles').select('*', head).then(n),
    sb.from('content_items').select('*', head).then(n),
    sb.from('reports').select('*', head).eq('status', 'open').then(n),
    sb.from('pipeline_jobs').select('*', head).eq('status', 'queued').then(n),
  ]);
  const stats: [string, number | null][] = [
    ['Users', users],
    ['Content items', content],
    ['Open reports', openReports],
    ['Queued jobs', queued],
  ];
  return (
    <>
      <h1>Overview</h1>
      <div className="grid">
        {stats.map(([k, v]) => (
          <div className="card" key={k}>
            <div className="muted">{k}</div>
            <div className="stat">{v ?? '—'}</div>
          </div>
        ))}
      </div>
      <p className="muted">
        “—” means your role cannot read that table (enforced by the database).
      </p>
    </>
  );
}
