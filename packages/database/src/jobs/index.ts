import { EVENT_TAXONOMY } from '@learning-loop/analytics';
import { ts, type Sql } from '../sql';

/**
 * Background jobs (docs/ANALYTICS.md, ARCHITECTURE.md). All are IDEMPOTENT: they recompute from a bounded window or
 * use unique keys, so retries and overlapping runs cannot duplicate or corrupt state. Intended runner: a scheduled
 * Edge Function / pg_cron under the `analytics_worker` identity. Never call from a user request path.
 */

const MIN_ANSWERS = 20;
const MIN_VIEWS = 30;

export interface QualityJobResult {
  questionsEvaluated: number;
  flaggedForRevision: number;
  contentScored: number;
}

/**
 * Content-quality loop (content → student response → quality signals → improvement candidates).
 *  - per question: incorrect/abandonment/negative-feedback rates, recovery rate (wrong first, right later = learning-gain proxy)
 *  - `needs_revision` when evidence suggests a bad item (e.g. almost nobody gets it right, or most skip immediately)
 *  - `suggested_difficulty` is recorded as EVIDENCE for editors; official difficulty is never changed silently.
 *  - `content_stats.quality_score` blends completion, saves, answer success and (negative) reports.
 */
export async function aggregateContentQuality(
  sql: Sql,
  now = Date.now(),
  windowDays = 30,
): Promise<QualityJobResult> {
  return sql.transaction(async (tx) => {
    const since = now - windowDays * 86_400_000;
    const qs = await tx.query<{
      question_id: string;
      n: number;
      correct: number;
      users: number;
      recovered: number;
      avg_ms: number | null;
      avg_difficulty: number | null;
    }>(
      `with a as (
         select question_id, user_id, correct, response_ms, created_at,
                row_number() over (partition by question_id, user_id order by created_at) as rn
           from question_attempts where created_at >= ${ts(1)}),
       firsts as (select question_id, user_id, correct as first_correct from a where rn = 1),
       later as (select question_id, user_id, bool_or(correct) as later_correct from a where rn > 1 group by 1, 2)
       select a.question_id, count(*)::int as n, count(*) filter (where a.correct)::int as correct, count(distinct a.user_id)::int as users,
              count(distinct f.user_id) filter (where not f.first_correct and l.later_correct)::int as recovered,
              avg(a.response_ms)::float as avg_ms, ci.difficulty as avg_difficulty
         from a join content_items ci on ci.id = a.question_id
         left join firsts f on f.question_id = a.question_id and f.user_id = a.user_id
         left join later l on l.question_id = a.question_id and l.user_id = a.user_id
        group by a.question_id, ci.difficulty`,
      [since],
    );

    let flagged = 0;
    for (const q of qs) {
      const incorrectRate = 1 - q.correct / q.n;
      const failedFirst = await tx.query<{ c: number }>(
        `select count(*)::int as c from (select distinct on (user_id) user_id, correct from question_attempts where question_id = $1 and created_at >= ${ts(2)} order by user_id, created_at) x where not correct`,
        [q.question_id, since],
      );
      const recoveryRate = failedFirst[0]!.c > 0 ? q.recovered / failedFirst[0]!.c : null;
      const skips = await tx.query<{ views: number; imm: number; reports: number }>(
        `select (select count(*) from events where name = 'feed_impression' and (payload->>'content_id') = $1 and created_at >= ${ts(2)})::int as views,
                (select count(*) from events where name = 'skip' and (payload->>'content_id') = $1 and coalesce((payload->>'immediate')::boolean, false) and created_at >= ${ts(2)})::int as imm,
                (select count(*) from reports where target_kind = 'content' and target_id = $1::uuid)::int as reports`,
        [q.question_id, since],
      );
      const s = skips[0]!;
      const abandonment = s.views >= MIN_VIEWS ? s.imm / s.views : null;
      const enough = q.n >= MIN_ANSWERS;
      const needs =
        (enough && incorrectRate >= 0.9) ||
        (abandonment !== null && abandonment >= 0.7) ||
        s.reports >= 3;
      if (needs) flagged++;
      // Elo-free, transparent suggestion: empirical difficulty = incorrect rate (shrunk toward current value with n)
      const w = Math.min(1, q.n / 50);
      const suggested = enough
        ? Math.round(((q.avg_difficulty ?? 0.5) * (1 - w) + incorrectRate * w) * 100) / 100
        : null;
      await tx.query(
        `insert into content_quality_signals(content_id, incorrect_rate, abandonment_rate, negative_feedback_rate, learning_gain, needs_revision, evidence, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
         on conflict (content_id) do update set incorrect_rate=excluded.incorrect_rate, abandonment_rate=excluded.abandonment_rate, negative_feedback_rate=excluded.negative_feedback_rate,
           learning_gain=excluded.learning_gain, needs_revision=excluded.needs_revision, evidence=excluded.evidence, updated_at=now()`,
        [
          q.question_id,
          incorrectRate,
          abandonment,
          s.views ? s.reports / s.views : null,
          recoveryRate,
          needs,
          JSON.stringify({
            window_days: windowDays,
            answers: q.n,
            learners: q.users,
            avg_response_ms: q.avg_ms,
            suggested_difficulty: suggested,
            reports: s.reports,
            enough_data: enough,
          }),
        ],
      );
      await tx.query(`insert into content_stats(content_id) values ($1) on conflict do nothing`, [
        q.question_id,
      ]);
      await tx.query(
        `update content_stats set learning_gain = $2, updated_at = now() where content_id = $1`,
        [q.question_id, recoveryRate],
      );
    }

    // quality_score for all content with enough impressions: completion + save rate − report pressure (0..1)
    const scored = await tx.query<{ content_id: string }>(
      `with imp as (
         select (payload->>'content_id') as cid, count(*) filter (where name = 'feed_impression') as views,
                count(*) filter (where name = 'watch_complete') as completes, count(*) filter (where name = 'save') as saves,
                count(*) filter (where name = 'skip' and coalesce((payload->>'immediate')::boolean,false)) as imm
           from events where created_at >= ${ts(1)} and (payload->>'content_id') ~ '^[0-9a-f-]{36}$' group by 1)
       update content_stats cs set quality_score = greatest(0, least(1,
            0.5 + 0.3 * (imp.completes::float / greatest(imp.views,1)) + 0.4 * (imp.saves::float / greatest(imp.views,1)) - 0.4 * (imp.imm::float / greatest(imp.views,1)))),
          updated_at = now()
       from imp where cs.content_id = imp.cid::uuid and imp.views >= ${MIN_VIEWS}
       returning cs.content_id`,
      [since],
    );
    return {
      questionsEvaluated: qs.length,
      flaggedForRevision: flagged,
      contentScored: scored.length,
    };
  });
}

/** Raw-event retention: aggregate-then-delete per taxonomy `retentionDays`. Rate-limit events pruned after 1 day. */
export async function pruneRawData(
  sql: Sql,
  now = Date.now(),
): Promise<{ events: number; rateLimitEvents: number }> {
  let events = 0;
  for (const [name, spec] of Object.entries(EVENT_TAXONOMY)) {
    const cutoff = now - spec.retentionDays * 86_400_000;
    const r = await sql.query<{ n: number }>(
      `with d as (delete from events where name = $1 and created_at < ${ts(2)} returning 1) select count(*)::int as n from d`,
      [name, cutoff],
    );
    events += r[0]?.n ?? 0;
  }
  const rl = await sql.query<{ n: number }>(
    `with d as (delete from rate_limit_events where created_at < ${ts(1)} returning 1) select count(*)::int as n from d`,
    [now - 86_400_000],
  );
  return { events, rateLimitEvents: rl[0]?.n ?? 0 };
}

/**
 * Review-due reminders. Respects notification_preferences (category `review_due`, default enabled) and sends AT MOST one per
 * user per UTC day (unique dedupe_key). Not a growth hack: no streak-loss threats, no false urgency; the text states what is due.
 */
export async function enqueueReviewDueNotifications(
  sql: Sql,
  now = Date.now(),
  minDue = 3,
): Promise<number> {
  const day = new Date(now).toISOString().slice(0, 10);
  const r = await sql.query<{ user_id: string }>(
    `insert into notifications(user_id, category, kind, payload, dedupe_key)
     select ri.user_id, 'review_due', 'review_due', jsonb_build_object('due', count(*)), 'review_due:' || $2
       from review_items ri
      where ri.due_at <= ${ts(1)}
        and not exists (select 1 from notification_preferences np where np.user_id = ri.user_id and np.category = 'review_due' and not np.enabled)
      group by ri.user_id having count(*) >= $3
     on conflict (user_id, dedupe_key) do nothing
     returning user_id`,
    [now, day, minDue],
  );
  return r.length;
}
