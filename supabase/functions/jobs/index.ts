import {
  aggregateContentQuality,
  enqueueReviewDueNotifications,
  pruneRawData,
} from '@learning-loop/database';
import { log } from '@learning-loop/shared';
import { json, sql } from '../_shared/runtime.ts';

/**
 * Scheduled background jobs (pg_cron / Supabase Scheduled Functions call this with a shared secret).
 * NOT callable by app users: requires `Authorization: Bearer $JOBS_SECRET`. All jobs are idempotent.
 */
const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

Deno.serve(async (req) => {
  const secret = Deno.env.get('JOBS_SECRET');
  const got = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!secret || secret.length < 24 || !timingSafeEqual(got, secret))
    return json(401, { error: 'unauthorized' });
  const job = new URL(req.url).searchParams.get('job');
  try {
    const db = sql();
    switch (job) {
      case 'content-quality':
        return json(200, await aggregateContentQuality(db));
      case 'retention':
        return json(200, await pruneRawData(db));
      case 'review-reminders':
        return json(200, { notified: await enqueueReviewDueNotifications(db) });
      default:
        return json(400, { error: 'unknown_job' });
    }
  } catch (e) {
    log.error('job failed', { job, error: (e as Error).message });
    return json(500, { error: 'internal' });
  }
});
