import Link from 'next/link';
import { requireStaff, supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
const TYPES = [
  '',
  'video',
  'note',
  'question',
  'quiz',
  'flashcard',
  'lesson',
  'course',
  'interactive',
];
const OWN = ['', 'official', 'creator', 'user'];

export default async function ContentList({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; ownership?: string }>;
}) {
  await requireStaff('moderation.review');
  const { q, type, ownership } = await searchParams;
  const sb = await supabaseServer();
  let query = sb
    .from('content_items')
    .select(
      'id,title,type,ownership,source_type,verification,publishing,moderation,freshness,updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(100);
  if (q) query = query.ilike('title', `%${q.replace(/[%_]/g, '')}%`);
  if (type) query = query.eq('type', type);
  if (ownership) query = query.eq('ownership', ownership);
  const { data, error } = await query;
  return (
    <>
      <h1>Content</h1>
      <form className="inline" role="search" style={{ marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="Search title" aria-label="Search title" />
        <select name="type" defaultValue={type ?? ''} aria-label="Type">
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t || 'all types'}
            </option>
          ))}
        </select>
        <select name="ownership" defaultValue={ownership ?? ''} aria-label="Ownership">
          {OWN.map((t) => (
            <option key={t} value={t}>
              {t || 'all sources'}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      {error ? <p role="alert">Could not load content.</p> : null}
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Ownership</th>
            <th>Source</th>
            <th>Verification</th>
            <th>Publishing</th>
            <th>Moderation</th>
            <th>Freshness</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/content/${c.id}`}>{c.title}</Link>
              </td>
              <td>{c.type}</td>
              <td>{c.ownership}</td>
              <td>{c.source_type}</td>
              <td>{c.verification}</td>
              <td>{c.publishing}</td>
              <td>{c.moderation}</td>
              <td>{c.freshness}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
