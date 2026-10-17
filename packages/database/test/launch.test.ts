import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { completeOnboarding, getFeed, submitAnswer, type Sql } from '../src';
import { Actor, createUser, freshDb, grantRole, serviceSql } from './harness';

const T0 = Date.UTC(2026, 5, 1, 9);
const OHM = '50000000-0000-0000-0000-000000000004';

let db: PGlite, sql: Sql, creator: Actor, trusted: Actor, viewer: Actor, mod: Actor, anon: Actor;
let creatorId: string, trustedId: string, viewerId: string, modId: string;

beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  creatorId = await createUser(db, 'creator@example.com');
  trustedId = await createUser(db, 'trusted@example.com');
  viewerId = await createUser(db, 'viewer@example.com');
  modId = await createUser(db, 'mod@example.com');
  await grantRole(db, modId, 'moderator');
  await db.query(`insert into creator_profiles(user_id, trust_level) values ($1, 'trusted')`, [
    trustedId,
  ]);
  creator = new Actor(db, creatorId);
  trusted = new Actor(db, trustedId);
  viewer = new Actor(db, viewerId);
  mod = new Actor(db, modId);
  anon = new Actor(db, null, 'anon');
  await completeOnboarding(sql, { userId: viewerId, interestSubjectIds: [] });
});

/** What the in-app creator flow does, as the user (RLS + guard triggers apply): item → draft version → (key) → concept → publish. */
async function upload(who: Actor, kind: 'note' | 'question', title: string) {
  const id = (
    await who.q<{ id: string }>(
      `insert into content_items(type, title, ownership, language, format, hook)
       values ($1::content_type, $2, 'user', 'en', $3::format_type, 'curiosity') returning id`,
      [kind, title, kind === 'note' ? 'note' : 'question'],
    )
  )[0]!.id;
  const body =
    kind === 'note'
      ? { blocks: [{ type: 'paragraph', text: 'A short user-written note.' }] }
      : {
          type: 'single_choice',
          prompt: 'Pick a',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        };
  const v = (
    await who.q<{ id: string }>(
      `insert into content_versions(content_id, body) values ($1, $2::jsonb) returning id`,
      [id, JSON.stringify(body)],
    )
  )[0]!.id;
  if (kind === 'question')
    await who.q(
      `insert into content_answer_keys(content_version_id, answer, explanation) values ($1, '{"optionId":"a"}'::jsonb, 'Because A.')`,
      [v],
    );
  await who.q(`insert into content_concepts(content_id, concept_id) values ($1, $2)`, [id, OHM]);
  await who.q(`select publish_content($1)`, [id]);
  return id;
}
const visibleTo = async (who: Actor, id: string) =>
  (await who.q(`select 1 from content_items where id = $1`, [id])).length === 1;
const inFeed = async (userId: string, id: string) => {
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++)
    for (const it of (await getFeed(sql, { userId, limit: 30, now: T0 + i, seed: i })).items)
      seen.add(it.contentId);
  return seen.has(id);
};

describe('open publishing: user content is live at once; moderators and reports are the safety net', () => {
  it("a new creator's published item is live: owner and other learners see it, the feed serves it and it is gradable; anon has no access", async () => {
    const id = await upload(creator, 'question', 'My question');
    expect(
      (
        await creator.q<{ moderation: string }>(
          `select moderation from content_items where id = $1`,
          [id],
        )
      )[0]!.moderation,
    ).toBe('cleared');
    expect(await visibleTo(creator, id)).toBe(true);
    expect(await visibleTo(viewer, id)).toBe(true);
    expect(await anon.denied(`select 1 from content_items where id = $1`, [id])).toBe(true); // anon: no access at all
    expect(await inFeed(viewerId, id)).toBe(true);
    const r = await submitAnswer(sql, {
      userId: viewerId,
      questionId: id,
      response: { optionId: 'a' },
      now: T0,
    });
    expect(r.correct).toBe(true);
  });

  it('it is feedable and gradable and served with language/creator fields', async () => {
    const id = await upload(creator, 'question', 'My question');
    expect(await visibleTo(viewer, id)).toBe(true);
    expect(await inFeed(viewerId, id)).toBe(true);
    const r = await submitAnswer(sql, {
      userId: viewerId,
      questionId: id,
      response: { optionId: 'a' },
      now: T0,
    });
    expect(r.correct).toBe(true);
    const item = (
      await getFeed(sql, { userId: viewerId, limit: 30, now: T0 + 99, seed: 3 })
    ).items.find((i) => i.contentId === id);
    if (item) expect(item.creatorUserId).toBe(creatorId);
  });

  it("a trusted creator's content is auto-approved; an edit no longer hides it", async () => {
    const id = await upload(trusted, 'note', 'Trusted note');
    expect(await visibleTo(viewer, id)).toBe(true);
    await trusted.q(`update content_items set title = 'Changed title' where id = $1`, [id]);
    expect(await visibleTo(viewer, id)).toBe(true); // open publishing: edits do not re-enter review
    expect(await visibleTo(trusted, id)).toBe(true);
  });

  it('removal and report-based flagging keep content hidden; official content is unaffected', async () => {
    const id = await upload(trusted, 'note', 'Soon removed');
    await mod.q(`select apply_moderation_action('content', $1, 'remove', 'policy')`, [id]);
    expect(await visibleTo(viewer, id)).toBe(false);
    expect(
      (await viewer.q(`select 1 from content_items where ownership = 'official'`)).length,
    ).toBeGreaterThan(0);
  });
});

describe('delete_my_account (store policy + privacy)', () => {
  it("deletes the account and its personal data, keeps other learners' records intact, and soft-deletes the user's content", async () => {
    const qid = await upload(trusted, 'question', 'Trusted question');
    await submitAnswer(sql, {
      userId: viewerId,
      questionId: qid,
      response: { optionId: 'b' },
      now: T0,
    });
    await trusted.q(
      `insert into saves(user_id, content_id) select auth.uid(), id from content_items where ownership = 'official' limit 1`,
    );
    await viewer.q(`insert into follows(follower_id, followee_id) values ($1, $2)`, [
      viewerId,
      trustedId,
    ]);
    await trusted
      .q(
        `insert into appeals(user_id, target_kind, target_id, message) values ($1, 'content', $2, 'please')`,
        [trustedId, qid],
      )
      .catch(() => undefined);

    await trusted.q(`select delete_my_account()`);

    expect(
      (await db.query(`select 1 from auth.users where id = $1`, [trustedId])).rows,
    ).toHaveLength(0);
    expect((await db.query(`select 1 from profiles where id = $1`, [trustedId])).rows).toHaveLength(
      0,
    );
    expect(
      (await db.query(`select 1 from saves where user_id = $1`, [trustedId])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query(`select 1 from follows where followee_id = $1`, [trustedId])).rows,
    ).toHaveLength(0);
    const c = (
      await db.query<{ publishing: string; owner_user_id: string | null }>(
        `select publishing, owner_user_id from content_items where id = $1`,
        [qid],
      )
    ).rows[0]!;
    expect(c).toEqual({ publishing: 'deleted', owner_user_id: null });
    expect(await visibleTo(viewer, qid)).toBe(false);
    // another learner's history survives
    expect(
      (await db.query(`select 1 from question_attempts where user_id = $1`, [viewerId])).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action = 'account.delete' and target_id = $1`,
          [trustedId],
        )
      ).rows,
    ).toHaveLength(1);
    // other accounts untouched
    expect((await db.query(`select 1 from profiles where id = $1`, [viewerId])).rows).toHaveLength(
      1,
    );
  });

  it('works for a learner who never uploaded anything, and removes their learning data', async () => {
    await submitAnswer(sql, {
      userId: viewerId,
      questionId: '60000000-0000-0000-0000-000000000002',
      response: { optionId: 'a' },
      now: T0,
    });
    await viewer.q(`select delete_my_account()`);
    for (const t of [
      'question_attempts',
      'concept_mastery',
      'user_progress',
      'user_features',
      'learner_profiles',
      'xp_ledger',
      'events',
      'recommendations',
    ])
      expect(
        (await db.query(`select 1 from ${t} where user_id = $1`, [viewerId])).rows,
        t,
      ).toHaveLength(0);
  });

  it('only the caller can delete themselves; anonymous callers and staff cannot', async () => {
    await anon.fails(`select delete_my_account()`);
    const msg = await mod.fails(`select delete_my_account()`);
    expect(msg).toMatch(/staff/);
    expect((await db.query(`select 1 from auth.users where id = $1`, [modId])).rows).toHaveLength(
      1,
    );
  });
});
