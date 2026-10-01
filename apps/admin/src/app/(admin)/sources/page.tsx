import { LICENSE_CODES, TRUST_LEVELS } from '@learning-loop/shared';
import { revalidatePath } from 'next/cache';
import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function Sources() {
  await requireStaff('sources.manage');
  const sb = await supabaseServer();
  const { data, error } = await sb
    .from('sources')
    .select(
      'id,slug,name,url,license,license_url,commercial_use_allowed,redistribution_allowed,modification_allowed,trust,status,last_checked_at',
    )
    .order('name');

  async function create(form: FormData) {
    'use server';
    await requireStaff('sources.manage');
    const sb = await supabaseServer();
    const tri = (k: string) => (form.get(k) === 'yes' ? true : form.get(k) === 'no' ? false : null);
    const url = String(form.get('url') ?? '');
    if (!/^https?:\/\//.test(url)) return;
    // New sources start 'pending' + 'needs_review': rights must be reviewed before anything is ingested (access ≠ reuse).
    await sb.from('sources').insert({
      slug: String(form.get('slug')),
      name: String(form.get('name')),
      url,
      license: String(form.get('license')),
      license_url: String(form.get('license_url') || '') || null,
      commercial_use_allowed: tri('commercial'),
      redistribution_allowed: tri('redistribution'),
      modification_allowed: tri('modification'),
      trust: 'needs_review',
      status: 'pending',
    });
    revalidatePath('/sources');
  }
  return (
    <>
      <h1>Source registry</h1>
      {error ? <p role="alert">Could not load sources.</p> : null}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>License</th>
            <th>Commercial</th>
            <th>Redistribute</th>
            <th>Modify</th>
            <th>Trust</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((s) => (
            <tr key={s.id}>
              <td>
                <a href={s.url} rel="noreferrer noopener" target="_blank">
                  {s.name}
                </a>
                <div className="muted">{s.slug}</div>
              </td>
              <td>{s.license}</td>
              <td>{fmt(s.commercial_use_allowed)}</td>
              <td>{fmt(s.redistribution_allowed)}</td>
              <td>{fmt(s.modification_allowed)}</td>
              <td>{s.trust}</td>
              <td>{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Register a source</h2>
      <p className="muted">
        Unknown rights are recorded as unknown and will be flagged for review — never assumed
        permitted.
      </p>
      <form action={create} className="card" style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
        <input name="slug" placeholder="slug (a-z, 0-9, -)" required pattern="[a-z0-9-]{2,80}" />
        <input name="name" placeholder="Name" required />
        <input name="url" type="url" placeholder="https://…" required />
        <select name="license" defaultValue="unknown" aria-label="License">
          {LICENSE_CODES.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <input name="license_url" type="url" placeholder="License URL" />
        {(['commercial', 'redistribution', 'modification'] as const).map((k) => (
          <label key={k}>
            {k} allowed{' '}
            <select name={k} defaultValue="unknown">
              <option value="unknown">unknown</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          </label>
        ))}
        <p className="muted">Trust levels: {TRUST_LEVELS.join(', ')} (set after review).</p>
        <button type="submit">Register</button>
      </form>
    </>
  );
}
const fmt = (v: boolean | null) => (v === null ? 'unknown' : v ? 'yes' : 'no');
