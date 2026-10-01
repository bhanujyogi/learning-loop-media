import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recommendation debugger: "why was this shown?" — signed feature contributions stored with every served item. */
export default async function Recommendations({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  await requireStaff('analytics.read');
  const { user } = await searchParams;
  const sb = await supabaseServer();
  const versions = await sb
    .from('ranking_versions')
    .select('version,status,activated_at,notes')
    .order('version');
  let recs: {
    id: string;
    ranking_version: string;
    created_at: string;
    variant: string | null;
    diagnostics: unknown;
    recommendation_items: {
      position: number;
      score: number;
      is_exploration: boolean;
      sources: string[];
      why_shown: Record<string, number>;
      content_items: { title: string } | null;
    }[];
  }[] = [];
  if (user && UUID.test(user)) {
    const r = await sb
      .from('recommendations')
      .select(
        'id,ranking_version,created_at,variant,diagnostics,recommendation_items(position,score,is_exploration,sources,why_shown,content_items(title))',
      )
      .eq('user_id', user)
      .order('created_at', { ascending: false })
      .limit(5);
    recs = (r.data ?? []) as never;
  }
  return (
    <>
      <h1>Recommendations</h1>
      <h2>Ranking versions</h2>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Activated</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {(versions.data ?? []).map((v) => (
            <tr key={v.version}>
              <td>{v.version}</td>
              <td>{v.status}</td>
              <td>{v.activated_at ? new Date(v.activated_at).toLocaleString() : '—'}</td>
              <td>{v.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Feed debugger</h2>
      <form className="inline">
        <input
          name="user"
          defaultValue={user}
          placeholder="learner user id (uuid)"
          aria-label="Learner user id"
          style={{ minWidth: 340 }}
        />
        <button type="submit">Inspect</button>
      </form>
      {user && !UUID.test(user) ? <p role="alert">Enter a valid UUID.</p> : null}
      {recs.map((r) => (
        <section className="card" key={r.id} style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0 }}>
            {r.ranking_version}
            {r.variant ? ` · ${r.variant}` : ''}{' '}
            <span className="muted">{new Date(r.created_at).toLocaleString()}</span>
          </h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Content</th>
                <th>Score</th>
                <th>Sources</th>
                <th>Why shown (signed contributions)</th>
              </tr>
            </thead>
            <tbody>
              {[...r.recommendation_items]
                .sort((a, b) => a.position - b.position)
                .map((i) => (
                  <tr key={i.position}>
                    <td>{i.position}</td>
                    <td>
                      {i.content_items?.title}
                      {i.is_exploration ? ' 🔭' : ''}
                    </td>
                    <td>{i.score.toFixed(3)}</td>
                    <td>{i.sources.join(', ')}</td>
                    <td>
                      {Object.entries(i.why_shown)
                        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                        .map(([k, v]) => `${k}: ${v > 0 ? '+' : ''}${v}`)
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
