import { EVENT_TAXONOMY } from '@learning-loop/analytics';
import { ts, type Sql } from '../sql.ts';

/**
 * Background jobs (docs/ANALYTICS.md, ARCHITECTURE.md). All are IDEMPOTENT: they recompute from a bounded window or
 * use unique keys, so retries and overlapping runs cannot duplicate or corrupt state. Intended runner: a scheduled
 * Edge Function / pg_cron under the `analytics_worker` identity. Never call from a user request path.
 */

/** Thresholds count DISTINCT LEARNERS, never raw attempts/events (audit H5: one user must not look like a crowd). */
const MIN_LEARNERS = 20;
const MIN_VIEWERS = 30;
const MIN_REPORT_WEIGHT = 3.0;

export interface QualityJobResult {
  questionsEvaluated: number;
  flaggedForRevision: number;
  contentScored: number;
}

/**
 * Content-quality loop (content → student response → quality signals → improvement candidates).
 *  - per question, using each learner's FIRST attempt in the window: incorrect rate; abandonment from distinct viewers;
 *    weighted distinct-reporter pressure; recovery rate (wrong first, right later = learning-gain proxy)
 *  - `needs_revision` only when enough DISTINCT learners/viewers/reporters support it
 *  - `suggested_difficulty` is recorded as EVIDENCE for editors; official difficulty is never changed silently.
 *  - `content_stats.quality_score` blends completion, saves and (negative) immediate skips, per distinct user.
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
      attempts: number;
      learners: number;
      first_wrong: number;
      recovered: number;
      avg_ms: number | null;
      avg_difficulty: number | null;
    }>(
      `with a as (
         select question_id, user_id, correct, response_ms, created_at,
                row_number() over (partition by question_id, user_id order by created_at) as rn
           from question_attempts where created_at >= ${ts(1)}),
       per_learner as (
         select question_id, user_id,
                bool_or(correct) filter (where rn = 1) as first_correct,
                bool_or(correct) filter (where rn > 1) as later_correct,
                count(*) as attempts
           from a group by question_id, user_id)
       select pl.question_id, sum(pl.attempts)::int as attempts, count(*)::int as learners,
              count(*) filter (where not pl.first_correct)::int as first_wrong,
              count(*) filter (where not pl.first_correct and coalesce(pl.later_correct, false))::int as recovered,
              (select avg(response_ms)::float from a where a.question_id = pl.question_id) as avg_ms,
              ci.difficulty as avg_difficulty
         from per_learner pl join content_items ci on ci.id = pl.question_id
        group by pl.question_id, ci.difficulty`,
      [since],
    );

    let flagged = 0;
    for (const q of qs) {
      const incorrectRate = q.first_wrong / q.learners;
      const recoveryRate = q.first_wrong > 0 ? q.recovered / q.first_wrong : null;
      const sig = (
        await tx.query<{
          viewers: number;
          imm_viewers: number;
          report_weight: number;
          reporters: number;
        }>(
          `select (select count(distinct user_id) from events where name = 'feed_impression' and (payload->>'content_id') = $1 and created_at >= ${ts(2)})::int as viewers,
                  (select count(distinct user_id) from events where name = 'skip' and (payload->>'content_id') = $1 and coalesce((payload->>'immediate')::boolean, false) and created_at >= ${ts(2)})::int as imm_viewers,
                  (select coalesce(sum(weight), 0) from reports where target_kind = 'content' and target_id = $1::uuid)::float as report_weight,
                  (select count(distinct reporter_id) from reports where target_kind = 'content' and target_id = $1::uuid)::int as reporters`,
          [q.question_id, since],
        )
      )[0]!;
      const abandonment = sig.viewers >= MIN_VIEWERS ? sig.imm_viewers / sig.viewers : null;
      const enough = q.learners >= MIN_LEARNERS;
      const needs =
        (enough && incorrectRate >= 0.9) ||
        (abandonment !== null && abandonment >= 0.7) ||
        (sig.reporters >= 3 && sig.report_weight >= MIN_REPORT_WEIGHT);
      if (needs) flagged++;
      // transparent suggestion: empirical difficulty = first-attempt incorrect rate, shrunk toward the current value with n learners
      const w = Math.min(1, q.learners / 50);
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
          sig.viewers ? sig.reporters / sig.viewers : null,
          recoveryRate,
          needs,
          JSON.stringify({
            window_days: windowDays,
            learners: q.learners,
            attempts: q.attempts,
            viewers: sig.viewers,
            reporters: sig.reporters,
            report_weight: sig.report_weight,
            avg_response_ms: q.avg_ms,
            suggested_difficulty: suggested,
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

    // quality_score for content with enough DISTINCT viewers: completion + save rate − immediate-skip rate (0..1)
    const scored = await tx.query<{ content_id: string }>(
      `with imp as (
         select (payload->>'content_id') as cid,
                count(distinct user_id) filter (where name = 'feed_impression') as views,
                count(distinct user_id) filter (where name = 'watch_complete') as completes,
                count(distinct user_id) filter (where name = 'save') as saves,
                count(distinct user_id) filter (where name = 'skip' and coalesce((payload->>'immediate')::boolean,false)) as imm
           from events where created_at >= ${ts(1)} and (payload->>'content_id') ~ '^[0-9a-f-]{36}$' group by 1)
       update content_stats cs set quality_score = greatest(0, least(1,
            0.5 + 0.3 * (imp.completes::float / greatest(imp.views,1)) + 0.4 * (imp.saves::float / greatest(imp.views,1)) - 0.4 * (imp.imm::float / greatest(imp.views,1)))),
          updated_at = now()
       from imp where cs.content_id = imp.cid::uuid and imp.views >= ${MIN_VIEWERS}
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
