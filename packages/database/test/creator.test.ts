import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeOnboarding,
  createContent,
  DomainFailure,
  getFeed,
  submitAnswer,
  type Sql,
} from '../src';
import { Actor, createUser, freshDb, grantRole, serviceSql } from './harness';

const T0 = Date.UTC(2026, 5, 1, 9);
const OHM = '50000000-0000-0000-0000-000000000004';
const note = (over: object = {}) => ({
  kind: 'note',
  title: 'My Ohm note',
  language: 'en',
  conceptId: OHM,
  body: { blocks: [{ type: 'paragraph', text: 'V = I x R' }] },
  ...over,
});
const question = (over: object = {}) => ({
  kind: 'question',
  title: 'Resistance unit (hi)',
  language: 'hi',
  conceptId: OHM,
  body: {
    type: 'single_choice',
    prompt: 'प्रतिरोध की इकाई?',
    options: [
      { id: 'a', text: 'ओम' },
      { id: 'b', text: 'वोल्ट' },
    ],
  },
  answer: { optionId: 'a' },
  explanation: 'ओम।',
  ...over,
});

let db: PGlite,
  asCaller: Sql,
  server: Sql,
  creator: string,
  trusted: string,
  viewer: string,
  modId: string;
beforeEach(async () => {
  db = await freshDb();
  await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
  asCaller = serviceSql(db, 'authenticated'); // exactly how the Edge Function runs it
  server = serviceSql(db, 'app_server');
  creator = await createUser(db, 'creator@example.com');
  trusted = await createUser(db, 'trusted@example.com');
  viewer = await createUser(db, 'viewer@example.com');
  modId = await createUser(db, 'mod@example.com');
  await grantRole(db, modId, 'moderator');
  await db.query(`insert into creator_profiles(user_id, trust_level) values ($1,'trusted')`, [
    trusted,
  ]);
  await completeOnboarding(server, { userId: viewer, language: 'hi', interestSubjectIds: [] });
});
const count = async (t = 'content_items') =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int n from ${t} where ownership = 'user' or '${t}' <> 'content_items'`,
    )
  ).rows[0]!.n;
const fails = async (p: Promise<unknown>) =>
  (await p.then(
    () => null,
    (e) => e,
  )) as DomainFailure | null;

describe('creator upload service', () => {
  it('publishes a note as the caller: owned by them, pending review, visible only to the owner', async () => {
    const r = await createContent(asCaller, creator, note());
    expect(r.moderation).toBe('pending_review');
    const row = (
      await db.query<{
        owner_user_id: string;
        uploader_id: string;
        ownership: string;
        language: string;
        publishing: string;
      }>(
        `select owner_user_id, uploader_id, ownership::text, language, publishing::text from content_items where id = $1`,
        [r.contentId],
      )
    ).rows[0]!;
    expect(row).toEqual({
      owner_user_id: creator,
      uploader_id: creator,
      ownership: 'user',
      language: 'en',
      publishing: 'published',
    });
    const asOwner = new Actor(db, creator),
      asViewer = new Actor(db, viewer);
    expect(
      await asOwner.q(`select 1 from content_items where id = $1`, [r.contentId]),
    ).toHaveLength(1);
    expect(
      await asViewer.q(`select 1 from content_items where id = $1`, [r.contentId]),
    ).toHaveLength(0);
    expect(
      (
        await db.query(`select 1 from content_concepts where content_id = $1 and concept_id = $2`, [
          r.contentId,
          OHM,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (await db.query(`select 1 from publish_log where content_id = $1`, [r.contentId])).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action = 'content.publish' and target_id = $1`,
          [r.contentId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("a trusted creator's upload goes live immediately", async () => {
    const r = await createContent(asCaller, trusted, note());
    expect(r.moderation).toBe('cleared');
    expect(
      await new Actor(db, viewer).q(`select 1 from content_items where id = $1`, [r.contentId]),
    ).toHaveLength(1);
  });

  it('a question keeps its key private; after approval it is served to Hindi learners and graded by the normal server path', async () => {
    const r = await createContent(asCaller, creator, question());
    const body = (
      await db.query<{ body: object }>(
        `select v.body from content_versions v where v.content_id = $1`,
        [r.contentId],
      )
    ).rows[0]!.body;
    expect(JSON.stringify(body)).not.toMatch(/answer|explanation|ओम।/);
    expect(
      (
        await db.query(
          `select 1 from content_answer_keys k join content_versions v on v.id = k.content_version_id where v.content_id = $1`,
          [r.contentId],
        )
      ).rows,
    ).toHaveLength(1);
    // not gradable/served before approval…
    await expect(
      submitAnswer(server, {
        userId: viewer,
        questionId: r.contentId,
        response: { optionId: 'a' },
        now: T0,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await new Actor(db, modId).q(
      `select apply_moderation_action('content', $1, 'approve', 'reviewed and approved for launch')`,
      [r.contentId],
    );
    // …and after approval the normal loop works
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++)
      for (const it of (await getFeed(server, { userId: viewer, limit: 30, now: T0 + i, seed: i }))
        .items)
        seen.add(it.contentId);
    expect(seen.has(r.contentId)).toBe(true);
    const res = await submitAnswer(server, {
      userId: viewer,
      questionId: r.contentId,
      response: { optionId: 'a' },
      now: T0,
    });
    expect(res).toMatchObject({ correct: true, explanation: 'ओम।' });
    expect(res.mastery[0]!.conceptId).toBe(OHM);
  });

  it('invalid submissions are rejected and write NOTHING', async () => {
    const before = await count();
    for (const bad of [
      note({ language: 'fr' }),
      note({ title: 'x' }),
      note({ body: { blocks: [] } }),
      note({ kind: 'video' }),
      question({ answer: { optionId: 'zzz' } }),
      question({ explanation: '' }),
      'garbage',
      null,
    ])
      expect(
        (await fails(createContent(asCaller, creator, bad)))?.code,
        JSON.stringify(bad)?.slice(0, 40),
      ).toBe('invalid_input');
    expect(await count()).toBe(before);
  });

  it('an unknown concept is rejected and rolls the whole upload back', async () => {
    const before = await count();
    const e = await fails(
      createContent(asCaller, creator, note({ conceptId: '99999999-9999-4999-8999-999999999999' })),
    );
    expect(e?.code).toBe('invalid_input');
    expect(await count()).toBe(before);
    expect(
      (
        await db.query(
          `select 1 from content_versions v join content_items c on c.id = v.content_id where c.ownership = 'user'`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('upload restrictions and rate limits are enforced by the database, not trusted to the app', async () => {
    await db.query(
      `insert into creator_restrictions(user_id, kind, reason, created_by) values ($1, 'no_upload', 'spam uploads', $2)`,
      [creator, modId],
    );
    expect((await fails(createContent(asCaller, creator, note())))?.code).toBe('forbidden');
    for (let i = 0; i < 20; i++)
      await createContent(asCaller, viewer, note({ title: `Note number ${i}` }));
    expect(
      (await fails(createContent(asCaller, viewer, note({ title: 'One too many' }))))?.code,
    ).toBe('rate_limited');
  });

  it("the service runs as the caller's role: the server role cannot be used to bypass ownership rules", async () => {
    // app_server has no write grant on content tables, so this service can only work under `authenticated`
    const e = await fails(createContent(server, creator, note()));
    expect(e).not.toBeNull();
    expect(await count()).toBe(0);
  });
});
