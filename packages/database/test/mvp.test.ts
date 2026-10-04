import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PREPARATION_LEVELS, SUPPORTED_LOCALES } from '@learning-loop/shared';
import { completeOnboarding, getFeed, loadFeatures, submitAnswer, type Sql } from '../src';
import { Actor, createUser, freshDb, serviceSql } from './harness';

const SCIENCE = '20000000-0000-0000-0000-000000000002';
const OHM = '50000000-0000-0000-0000-000000000004';
const T0 = Date.UTC(2026, 5, 1, 9);

let db: PGlite, sql: Sql, user: string, other: string;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  sql = serviceSql(db, 'app_server');
  user = await createUser(db, 'learner@example.com');
  other = await createUser(db, 'other@example.com');
});

/** Privileged test fixture: a published, cleared, user-owned note in an arbitrary language. */
async function addNote(id: string, language: string, owner: string | null = null) {
  const official = owner === null;
  await db.query(
    `insert into content_items(id, type, title, language, ownership, owner_user_id, owner_org_id, publishing_identity_id, source_type, verification, publishing, moderation, hook, format, difficulty, published_at, latest_version_no)
     values ($1,'note',$2,$3,$4::ownership_kind,$5,$6,$7,'original',$8::verification_status,'published',$9::moderation_status,'curiosity','note',0.3,now(),1)`,
    [
      id,
      `Fixture ${language} ${id.slice(-4)}`,
      language,
      official ? 'official' : 'user',
      owner,
      official ? '00000000-0000-0000-0000-0000000000a1' : null,
      official ? '00000000-0000-0000-0000-0000000000b1' : null,
      official ? 'official' : 'unverified',
      official ? 'none' : 'cleared',
    ],
  );
  const v = (
    await db.query<{ id: string }>(
      `insert into content_versions(content_id, version_no, state, body, frozen_at)
       values ($1, 1, 'published', '{"blocks":[{"type":"paragraph","text":"fixture"}]}'::jsonb, now()) returning id`,
      [id],
    )
  ).rows[0]!.id;
  await db.query(`update content_items set current_version_id = $2 where id = $1`, [id, v]);
  await db.query(`insert into content_concepts(content_id, concept_id) values ($1,$2)`, [id, OHM]);
}
const feedIds = async (u: string) =>
  (await getFeed(sql, { userId: u, limit: 30, now: T0, seed: 1 })).items;

describe('onboarding: language + preparation level (existing secure path)', () => {
  it('stores the language in profiles.locale, the level on the learner profile, and seeds the ability prior', async () => {
    await completeOnboarding(sql, {
      userId: user,
      language: 'hi',
      preparationLevel: 'advanced',
      examId: '10000000-0000-0000-0000-000000000001',
      interestSubjectIds: [SCIENCE],
    });
    expect(
      (await db.query<{ locale: string }>(`select locale from profiles where id = $1`, [user]))
        .rows[0]!.locale,
    ).toBe('hi');
    const lp = (
      await db.query<{ preparation_level: string; onboarding_completed: boolean }>(
        `select preparation_level, onboarding_completed from learner_profiles where user_id = $1`,
        [user],
      )
    ).rows[0]!;
    expect(lp).toEqual({ preparation_level: 'advanced', onboarding_completed: true });
    const f = await sql.transaction((tx) => loadFeatures(tx, user));
    expect(f.ability).toBe(0.65);
  });

  it('ignores unsupported languages / levels instead of storing junk (defaults stay)', async () => {
    await completeOnboarding(sql, {
      userId: user,
      language: 'xx' as never,
      preparationLevel: 'wizard' as never,
      interestSubjectIds: [],
    });
    expect(
      (await db.query<{ locale: string }>(`select locale from profiles where id = $1`, [user]))
        .rows[0]!.locale,
    ).toBe('en');
    expect(
      (
        await db.query<{ preparation_level: string | null }>(
          `select preparation_level from learner_profiles where user_id = $1`,
          [user],
        )
      ).rows[0]!.preparation_level,
    ).toBeNull();
  });

  it('onboarding is idempotent and only ever touches the bound user', async () => {
    await completeOnboarding(sql, { userId: user, language: 'hi', interestSubjectIds: [] });
    await completeOnboarding(sql, { userId: user, language: 'hi', interestSubjectIds: [] });
    const rows = (await db.query<{ id: string; locale: string }>(`select id, locale from profiles`))
      .rows;
    expect(rows.find((r) => r.id === other)!.locale).toBe('en');
  });
});

describe('language preference is a real, enforced learner preference', () => {
  const HI = '70000000-0000-0000-0000-000000000001';
  const FR = '70000000-0000-0000-0000-000000000002';
  beforeEach(async () => {
    await addNote(HI, 'hi');
    await addNote(FR, 'fr');
  });

  it('an English learner never sees Hindi (or other) content', async () => {
    const ids = (await feedIds(user)).map((i) => i.contentId);
    expect(ids).not.toContain(HI);
    expect(ids).not.toContain(FR);
    expect((await feedIds(user)).every((i) => i.language === 'en')).toBe(true);
  });

  it('a Hindi learner sees Hindi + English fallback, never unrelated languages', async () => {
    await completeOnboarding(sql, { userId: user, language: 'hi', interestSubjectIds: [] });
    const items = await feedIds(user);
    const ids = items.map((i) => i.contentId);
    expect(ids).toContain(HI);
    expect(ids).not.toContain(FR);
    expect(new Set(items.map((i) => i.language))).toEqual(new Set(['en', 'hi']));
  });

  it('changing the preference changes the feed (the client writes its own locale via RLS)', async () => {
    await new Actor(db, user).q(`update profiles set locale = 'hi' where id = $1`, [user]);
    expect((await feedIds(user)).map((i) => i.contentId)).toContain(HI);
  });
});

describe('profiles.locale security', () => {
  it('rejects malformed locales at the database', async () => {
    const msg = await new Actor(db, user).fails(
      `update profiles set locale = 'EN us!' where id = $1`,
      [user],
    );
    expect(msg).toMatch(/profiles_locale_format|check/i);
  });
  it("the service role can read/update ONLY the bound user's locale and no other profile column", async () => {
    // each statement in its own transaction: a failed statement aborts its transaction
    const asBound = <R>(fn: (tx: Sql) => Promise<R>) =>
      sql.transaction(async (tx) => {
        await tx.query(
          `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', json_build_object('sub', $1::text)::text, true)`,
          [user],
        );
        return fn(tx);
      });
    // another user's row is invisible / untouchable
    expect(
      await asBound((tx) => tx.query(`select id from profiles where id = $1`, [other])),
    ).toHaveLength(0);
    await asBound((tx) => tx.query(`update profiles set locale = 'hi' where id = $1`, [other]));
    expect(
      (await db.query<{ locale: string }>(`select locale from profiles where id = $1`, [other]))
        .rows[0]!.locale,
    ).toBe('en');
    // the bound user's own locale works; every other column is closed
    await asBound((tx) => tx.query(`update profiles set locale = 'hi' where id = $1`, [user]));
    await expect(
      asBound((tx) => tx.query(`update profiles set display_name = 'x' where id = $1`, [user])),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asBound((tx) => tx.query(`select username from profiles where id = $1`, [user])),
    ).rejects.toThrow(/permission denied/i);
  });
  it('shared constants match the SQL check constraints (parity)', async () => {
    const def = (
      await db.query<{ d: string }>(
        `select pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class t on t.oid = c.conrelid
          where t.relname = 'learner_profiles' and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%preparation_level%'`,
      )
    ).rows[0]!.d;
    expect([...def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()).toEqual(
      [...PREPARATION_LEVELS].sort(),
    );
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('hi');
  });
});

describe('follows feed the recommendation engine (followed_creator source)', () => {
  const FOLLOWED = '70000000-0000-0000-0000-000000000010';
  it("surfaces a followed creator's content with the creator id, and only the follower's own edges count", async () => {
    await addNote(FOLLOWED, 'en', other);
    await new Actor(db, user).q(`insert into follows(follower_id, followee_id) values ($1,$2)`, [
      user,
      other,
    ]);
    const res = await getFeed(sql, { userId: user, limit: 30, now: T0, seed: 1 });
    const item = res.items.find((i) => i.contentId === FOLLOWED)!;
    expect(item.creatorUserId).toBe(other);
    expect(item.official).toBe(false);
    const sources = (
      await db.query<{ sources: string[] }>(
        `select sources from recommendation_items where recommendation_id = $1 and content_id = $2`,
        [res.recommendationId, FOLLOWED],
      )
    ).rows[0]!.sources;
    expect(sources).toContain('followed_creator');
    // official content is not followable (no user id)
    expect(res.items.filter((i) => i.official).every((i) => i.creatorUserId === null)).toBe(true);
  });
});

describe('seeded Hindi dev content works end to end', () => {
  const HI_IDS = [
    '60000000-0000-0000-0000-000000000007',
    '60000000-0000-0000-0000-000000000008',
    '60000000-0000-0000-0000-000000000009',
  ];
  const HI_TF = HI_IDS[2]!;
  it('a Hindi learner is served Hindi seed items (plus English fallback); an English learner never is', async () => {
    expect((await feedIds(user)).some((i) => HI_IDS.includes(i.contentId))).toBe(false);
    await completeOnboarding(sql, { userId: other, language: 'hi', interestSubjectIds: [] });
    // ranking applies diversity limits, so a batch holds a subset: collect across batches until the pool is drained
    const seen: { contentId: string; language: string; body: unknown }[] = [];
    for (let i = 0; i < 6; i++)
      seen.push(...(await getFeed(sql, { userId: other, limit: 30, now: T0 + i, seed: i })).items);
    expect(seen.some((i) => HI_IDS.includes(i.contentId))).toBe(true);
    expect(seen.some((i) => i.language === 'en')).toBe(true);
    expect(seen.every((i) => i.language === 'en' || i.language === 'hi')).toBe(true);
    // answer keys never ride along in the public body, in any language
    expect(JSON.stringify(seen.map((i) => i.body))).not.toMatch(
      /explanation|"answer"|"optionId":"a"\}/,
    );
  });
  it('Hindi questions are graded by the same server path', async () => {
    const r = await submitAnswer(sql, {
      userId: other,
      questionId: HI_TF,
      response: { value: true },
      responseMs: 3000,
      now: T0,
    });
    expect(r.correct).toBe(true);
    expect(r.explanation).toContain('जयपुर');
    const wrong = await submitAnswer(sql, {
      userId: user,
      questionId: HI_TF,
      response: { value: false },
      responseMs: 3000,
      now: T0,
    });
    expect(wrong.correct).toBe(false);
  });
});

describe('mobile ↔ server contract (drift guard)', () => {
  const mobileKeys = (iface: string) => {
    const src = readFileSync(join(__dirname, '../../../apps/mobile/src/lib/api.ts'), 'utf8');
    const m = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(src)!;
    return [...m[1]!.matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1]!).sort();
  };
  it('FeedItem fields in the app are exactly the fields the feed returns', async () => {
    const [item] = (await getFeed(sql, { userId: user, limit: 1, now: T0, seed: 1 })).items;
    expect(mobileKeys('FeedItem')).toEqual(Object.keys(item!).sort());
  });
  it('SubmitAnswerResponse fields in the app are exactly what submitAnswer returns', async () => {
    const r = await submitAnswer(sql, {
      userId: user,
      questionId: '60000000-0000-0000-0000-000000000002',
      response: { optionId: 'a' },
      responseMs: 2000,
      now: T0,
    });
    expect(mobileKeys('SubmitAnswerResponse')).toEqual(Object.keys(r).sort());
  });
});
