import { revalidatePath } from 'next/cache';
import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const ACTIONS = ['approve', 'restrict', 'remove', 'restore'] as const;

export default async function Moderation() {
  const staff = await requireStaff('moderation.review');
  const canAct = staff.permissions.has('moderation.act');
  const sb = await supabaseServer();
  const { data: reports, error } = await sb
    .from('reports')
    .select('id,target_kind,target_id,reason,details,status,created_at')
    .eq('status', 'open')
    .order('created_at')
    .limit(100);

  async function act(form: FormData) {
    'use server';
    await requireStaff('moderation.act'); // re-checked server-side; the RPC enforces it again in Postgres
    const sb = await supabaseServer();
    const reason = String(form.get('reason') ?? '').trim();
    const action = String(form.get('action'));
    if (!ACTIONS.includes(action as never) || reason.length < 3) return;
    await sb.rpc('apply_moderation_action', {
      p_target_kind: String(form.get('kind')),
      p_target_id: String(form.get('target')),
      p_action: action,
      p_reason: reason,
    });
    revalidatePath('/moderation');
  }
  // group by target
  const groups = new Map<string, NonNullable<typeof reports>>();
  for (const r of reports ?? []) {
    const k = `${r.target_kind}:${r.target_id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <>
      <h1>Moderation queue</h1>
      {error ? <p role="alert">Could not load reports.</p> : null}
      {groups.size === 0 ? <p className="muted">No open reports.</p> : null}
      {[...groups.entries()].map(([k, rs]) => {
        const first = rs[0]!;
        return (
          <section key={k} className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ marginTop: 0 }}>
              {first.target_kind} <code>{first.target_id}</code>{' '}
              <span className="badge">
                {rs.length} report{rs.length > 1 ? 's' : ''}
              </span>
            </h2>
            <ul>
              {rs.map((r) => (
                <li key={r.id}>
                  {r.reason}
                  {r.details ? ` — ${r.details}` : ''}{' '}
                  <span className="muted">({new Date(r.created_at).toLocaleString()})</span>
                </li>
              ))}
            </ul>
            {first.target_kind === 'content' ? (
              <a href={`/content/${first.target_id}`}>Inspect content & provenance</a>
            ) : null}
            {canAct ? (
              <form action={act} className="inline" style={{ marginTop: 8 }}>
                <input type="hidden" name="kind" value={first.target_kind} />
                <input type="hidden" name="target" value={first.target_id} />
                <label>
                  Reason <input name="reason" required minLength={3} maxLength={500} />
                </label>
                {ACTIONS.map((a) => (
                  <button
                    key={a}
                    name="action"
                    value={a}
                    className={a === 'remove' ? 'danger' : 'secondary'}
                  >
                    {a}
                  </button>
                ))}
              </form>
            ) : (
              <p className="muted">Read-only: you do not have moderation.act.</p>
            )}
          </section>
        );
      })}
    </>
  );
}
