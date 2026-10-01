import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function Experiments() {
  await requireStaff('experiments.manage');
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('experiments')
    .select('id,key,hypothesis,status,variants,starts_at,ends_at,results')
    .order('created_at', { ascending: false });
  return (
    <>
      <h1>Experiments</h1>
      {error ? <p role="alert">Could not load experiments.</p> : null}
      {(data ?? []).length === 0 ? (
        <p className="muted">
          No experiments yet. Algorithm changes must be recorded here (hypothesis, variants, ranking
          version) — never changed silently.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Hypothesis</th>
              <th>Status</th>
              <th>Variants</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((e) => (
              <tr key={e.id}>
                <td>{e.key}</td>
                <td>{e.hypothesis}</td>
                <td>{e.status}</td>
                <td>
                  <code>{JSON.stringify(e.variants)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
