import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function Pipeline() {
  await requireStaff('pipeline.run');
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('pipeline_jobs')
    .select('id,kind,status,attempts,max_attempts,error,created_at,finished_at')
    .order('created_at', { ascending: false })
    .limit(100);
  return (
    <>
      <h1>Pipeline jobs</h1>
      <p className="muted">
        Ingestion, generation, validation and publishing jobs. Jobs are idempotent and retryable;
        errors are sanitised before storage.
      </p>
      {error ? <p role="alert">Could not load jobs.</p> : null}
      {(data ?? []).length === 0 ? (
        <p className="muted">
          No jobs yet. The pipeline is built but intentionally not generating content.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((j) => (
              <tr key={j.id}>
                <td>{j.kind}</td>
                <td>{j.status}</td>
                <td>
                  {j.attempts}/{j.max_attempts}
                </td>
                <td>{j.error ?? ''}</td>
                <td>{new Date(j.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
