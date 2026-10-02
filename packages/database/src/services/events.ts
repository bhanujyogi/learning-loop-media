import { FEEDBACK_MAP, sanitizeEvent, skipSignal, type RawEvent } from '@learning-loop/analytics';
import {
  applyFeedback,
  recordImpression,
  type LearnerFeatures,
} from '@learning-loop/recommendation-engine';
import { asUser, ts, type Sql } from '../sql.ts';
import { loadFeatures, saveFeatures } from './features-store.ts';

interface ContentMeta {
  id: string;
  format: string | null;
  hook: string | null;
  owner: string | null;
  subject: string | null;
  concepts: string[];
}

export async function contentMeta(sql: Sql, ids: string[]): Promise<Map<string, ContentMeta>> {
  if (!ids.length) return new Map();
  const rows = await sql.query<{
    id: string;
    format: string | null;
    hook: string | null;
    owner: string | null;
    subject: string | null;
    concepts: string[] | null;
  }>(
    `select c.id, c.format, c.hook, coalesce(c.owner_user_id::text, c.owner_org_id::text) as owner,
            (select s.id::text from content_concepts cc join concepts co on co.id = cc.concept_id join topics t on t.id = co.topic_id
               join chapters ch on ch.id = t.chapter_id join subjects s on s.id = ch.subject_id where cc.content_id = c.id order by cc.role limit 1) as subject,
            (select array_agg(concept_id::text) from content_concepts where content_id = c.id) as concepts
       from content_items c where c.id = any($1::uuid[])`,
    [ids],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        format: r.format,
        hook: r.hook,
        owner: r.owner,
        subject: r.subject,
        concepts: r.concepts ?? [],
      },
    ]),
  );
}

/**
 * Batch of client behavioural events: sanitise → store raw → fold into engagement features.
 * Unknown events are dropped, payloads are minimised (docs/ANALYTICS.md). Learning events are NOT accepted here
 * for mastery purposes — those come only from submitAnswer().
 */
export async function recordEvents(
  sql: Sql,
  userId: string,
  raw: RawEvent[],
  now = Date.now(),
): Promise<{ accepted: number; dropped: number }> {
  const clean = raw
    .slice(0, 100)
    .map((r) => sanitizeEvent(r, now))
    .filter((e): e is NonNullable<typeof e> => !!e);
  if (!clean.length) return { accepted: 0, dropped: raw.length };
  return asUser(sql, userId, async (tx) => {
    for (const e of clean)
      await tx.query(
        `insert into events(user_id, name, payload, client_at) values ($1,$2,$3::jsonb, ${ts(4)})`,
        [userId, e.name, JSON.stringify(e.payload), e.at],
      );
    const ids = [
      ...new Set(
        clean
          .map((e) => (e.payload.content_id ?? e.payload.question_id) as string | undefined)
          .filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x)),
      ),
    ];
    const meta = await contentMeta(tx, ids);
    let f: LearnerFeatures = await loadFeatures(tx, userId);
    for (const e of clean) {
      const cid = (e.payload.content_id ?? e.payload.question_id) as string | undefined;
      const m = cid ? meta.get(cid) : undefined;
      if (e.name === 'feed_impression' && m) {
        f = recordImpression(f, {
          contentId: m.id,
          conceptIds: m.concepts,
          creatorId: m.owner ?? 'unknown',
          hook: m.hook,
          format: m.format ?? 'note',
        });
        continue;
      }
      if (e.name === 'skip') {
        f = applyFeedback(f, {
          type: 'engagement',
          name: skipSignal(e.payload as { watched_ms?: number; immediate?: boolean }),
          subjectId: m?.subject ?? undefined,
          format: m?.format ?? undefined,
          hook: m?.hook,
          creatorId: m?.owner ?? undefined,
        });
        f = { ...f, sessionFatigue: Math.min(1, f.sessionFatigue + 0.1) };
        continue;
      }
      const map = FEEDBACK_MAP[e.name];
      // Learning-type feedback is excluded here: mastery evidence only originates from the server-graded path.
      if (map && map.type === 'engagement' && m) {
        f = applyFeedback(f, {
          type: 'engagement',
          name: map.name,
          subjectId: m.subject ?? undefined,
          format: m.format ?? undefined,
          hook: m.hook,
          creatorId: m.owner ?? undefined,
        });
        f = { ...f, sessionFatigue: Math.max(0, f.sessionFatigue - 0.05) };
        if (e.name === 'follow' && m.owner && !f.followedCreatorIds.includes(m.owner))
          f = { ...f, followedCreatorIds: [...f.followedCreatorIds, m.owner] };
      }
    }
    await saveFeatures(tx, f);
    return { accepted: clean.length, dropped: raw.length - clean.length };
  });
}
