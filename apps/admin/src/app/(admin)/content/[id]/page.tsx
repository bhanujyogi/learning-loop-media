import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/** Provenance inspector: where did this come from, under what license, transformed how, by which model/process, published by whom. */
export default async function ContentDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff('moderation.review');
  const { id } = await params;
  const sb = await supabaseServer();
  const [item, versions] = await Promise.all([
    sb.from('content_items').select('*').eq('id', id).maybeSingle(),
    sb
      .from('content_versions')
      .select('id,version_no,state,change_note,created_at,frozen_at')
      .eq('content_id', id)
      .order('version_no', { ascending: false }),
  ]);
  if (!item.data)
    return (
      <>
        <h1>Not found</h1>
        <p className="muted">No such content, or you cannot see it.</p>
      </>
    );
  const vids = (versions.data ?? []).map((v) => v.id);
  const [prov, gates] = vids.length
    ? await Promise.all([
        sb
          .from('content_provenance')
          .select(
            'id,content_version_id,transformation,generated_by,model_identifier,model_version,prompt_version,process_name,generated_at,validation_status,review_status,publishing_identity_id,content_provenance_sources(license_snapshot,sources(name,url,license,publisher,author))',
          )
          .in('content_version_id', vids),
        sb
          .from('quality_gate_results')
          .select('content_version_id,gate,passed,messages')
          .in('content_version_id', vids),
      ])
    : [{ data: [] }, { data: [] }];
  return (
    <>
      <h1>{item.data.title}</h1>
      <p>
        <span className="badge">{item.data.type}</span>{' '}
        <span className="badge">{item.data.ownership}</span>{' '}
        <span className="badge">{item.data.verification}</span>{' '}
        <span className="badge">{item.data.publishing}</span>{' '}
        <span className="badge">moderation: {item.data.moderation}</span>
      </p>
      <h2>Versions</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>State</th>
            <th>Created</th>
            <th>Frozen</th>
          </tr>
        </thead>
        <tbody>
          {(versions.data ?? []).map((v) => (
            <tr key={v.id}>
              <td>v{v.version_no}</td>
              <td>{v.state}</td>
              <td>{new Date(v.created_at).toLocaleString()}</td>
              <td>{v.frozen_at ? new Date(v.frozen_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Provenance</h2>
      {(prov.data ?? []).length === 0 ? (
        <p className="muted">No provenance recorded.</p>
      ) : (
        <pre>{JSON.stringify(prov.data, null, 2)}</pre>
      )}
      <h2>Quality gates</h2>
      {(gates.data ?? []).length === 0 ? (
        <p className="muted">No gate results.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Gate</th>
              <th>Result</th>
              <th>Messages</th>
            </tr>
          </thead>
          <tbody>
            {(gates.data ?? []).map((g, i) => (
              <tr key={i}>
                <td>
                  {vids.indexOf(g.content_version_id) >= 0
                    ? `v${(versions.data ?? []).find((v) => v.id === g.content_version_id)?.version_no}`
                    : ''}
                </td>
                <td>{g.gate}</td>
                <td>{g.passed ? '✓ passed' : '✗ failed'}</td>
                <td>{(g.messages ?? []).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
