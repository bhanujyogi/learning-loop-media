import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function Audit() {
  await requireStaff('audit.read');
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('audit_log')
    .select('id,actor_id,actor_kind,action,target_kind,target_id,reason,created_at')
    .order('id', { ascending: false })
    .limit(200);
  return (
    <>
      <h1>Audit log</h1>
      {error ? <p role="alert">Could not load audit log.</p> : null}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.created_at).toLocaleString()}</td>
              <td>
                {a.actor_kind}
                {a.actor_id ? ` ${a.actor_id.slice(0, 8)}` : ''}
              </td>
              <td>{a.action}</td>
              <td>
                {a.target_kind} {a.target_id}
              </td>
              <td>{a.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
