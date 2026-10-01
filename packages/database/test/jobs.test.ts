import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateContentQuality,
  enqueueReviewDueNotifications,
  pruneRawData,
  submitAnswer,
  type Sql,
} from '../src';
import { createUser, freshDb } from './harness';

const Q_UNIT = '60000000-0000-0000-0000-000000000002';
const Q_CALC = '60000000-0000-0000-0000-000000000003';
const T0 = Date.UTC(2026, 5, 1, 9);
const DAY = 86_400_000;

const adapt = (db: PGlite): Sql => ({
  query: async (t, p) => (await db.query(t, p as never[])).rows as never,
  transaction: (fn) =>
    db.transaction((tx) =>
      fn({
        query: async (t, p) => (await tx.query(t, p as never[])).rows as never,
        transaction: () => {
          throw new Error('nested');
        },
      } as Sql),
    ),
});

let db: PGlite, sql: Sql;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = adapt(db);
});

describe('background jobs', () => {
  it('quality loop flags items almost nobody answers correctly and is idempotent', async () => {
    for (let i = 0; i < 22; i++) {
      const u = await createUser(db, `u${i}@example.com`);
      await submitAnswer(sql, {
        userId: u,
        questionId: Q_CALC,
        response: { value: 7 },
        now: T0 + i * 1000,
      });
    }
    const a = await aggregateContentQuality(sql, T0 + DAY);
    expect(a.questionsEvaluated).toBe(1);
    expect(a.flaggedForRevision).toBe(1);
    const sig = (
      await db.query(
        `select needs_revision, incorrect_rate, evidence from content_quality_signals where content_id = $1`,
        [Q_CALC],
      )
    ).rows[0] as {
      needs_revision: boolean;
      incorrect_rate: number;
      evidence: { suggested_difficulty: number; answers: number };
    };
    expect(sig.needs_revision).toBe(true);
    expect(sig.incorrect_rate).toBe(1);
    expect(sig.evidence.answers).toBe(22);
    // official difficulty is NOT silently changed; suggestion is evidence only
    expect(
      (await db.query(`select difficulty from content_items where id = $1`, [Q_CALC])).rows[0],
    ).toEqual({ difficulty: 0.4 });
    const b = await aggregateContentQuality(sql, T0 + DAY);
    expect(b).toEqual(a);
    expect((await db.query(`select 1 from content_quality_signals`)).rows).toHaveLength(1);
  });

  it('does not flag with too little data, and measures recovery (wrong first, right later) as a learning-gain proxy', async () => {
    const u = await createUser(db, 'x@example.com');
    await submitAnswer(sql, {
      userId: u,
      questionId: Q_UNIT,
      response: { optionId: 'b' },
      now: T0,
    });
    await submitAnswer(sql, {
      userId: u,
      questionId: Q_UNIT,
      response: { optionId: 'a' },
      now: T0 + 3600_000,
    });
    const r = await aggregateContentQuality(sql, T0 + DAY);
    expect(r.flaggedForRevision).toBe(0);
    const s = (
      await db.query(
        `select learning_gain, evidence from content_quality_signals where content_id = $1`,
        [Q_UNIT],
      )
    ).rows[0] as {
      learning_gain: number;
      evidence: { enough_data: boolean; suggested_difficulty: number | null };
    };
    expect(s.learning_gain).toBe(1);
    expect(s.evidence.enough_data).toBe(false);
    expect(s.evidence.suggested_difficulty).toBeNull();
  });

  it('retention prunes by taxonomy retentionDays and old rate-limit rows', async () => {
    const u = await createUser(db, 'r@example.com');
    await db.query(
      `insert into events(user_id, name, payload, created_at) values ($1,'like','{}', to_timestamp($2/1000.0)), ($1,'like','{}', to_timestamp($3/1000.0)), ($1,'flashcard_reviewed','{}', to_timestamp($2/1000.0))`,
      [u, T0 - 100 * DAY, T0 - 1 * DAY],
    );
    await db.query(
      `insert into rate_limit_events(user_id, action, created_at) values ($1,'comment_create', to_timestamp($2/1000.0))`,
      [u, T0 - 3 * DAY],
    );
    const r = await pruneRawData(sql, T0);
    expect(r.events).toBe(1); // like>90d pruned; recent like and 100-day-old learning event (365d retention) kept
    expect(r.rateLimitEvents).toBe(1);
    expect(
      (await db.query(`select name from events order by id`)).rows.map(
        (x) => (x as { name: string }).name,
      ),
    ).toEqual(['like', 'flashcard_reviewed']);
  });

  it('review-due notifications: threshold, once per day, and they respect preferences', async () => {
    const [a, b, c] = [
      await createUser(db, 'a@example.com'),
      await createUser(db, 'b@example.com'),
      await createUser(db, 'c@example.com'),
    ];
    const mk = async (u: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const id = (
          await db.query<{ id: string }>(
            `insert into content_items(type,title,ownership,owner_user_id,publishing) values ('flashcard','f'||$2,'user',$1,'draft') returning id`,
            [u, String(i) + u],
          )
        ).rows[0]!.id;
        await db.query(
          `insert into review_items(user_id, content_id, due_at) values ($1,$2, to_timestamp($3/1000.0))`,
          [u, id, T0 - 1000],
        );
      }
    };
    await mk(a, 3);
    await mk(b, 5);
    await mk(c, 2);
    await db.query(
      `insert into notification_preferences(user_id, category, enabled) values ($1,'review_due', false)`,
      [b],
    );
    expect(await enqueueReviewDueNotifications(sql, T0)).toBe(1); // a only: b opted out, c below threshold
    expect(await enqueueReviewDueNotifications(sql, T0 + 1000)).toBe(0); // same day → no duplicate
    expect(await enqueueReviewDueNotifications(sql, T0 + DAY)).toBe(1); // next day
  });
});
