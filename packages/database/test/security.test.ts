import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { Actor, createUser, freshDb, grantRole } from './harness';

let db: PGlite;
let alice: Actor,
  bob: Actor,
  carol: Actor,
  dave: Actor,
  mod: Actor,
  admin: Actor,
  pub: Actor,
  anon: Actor;
let orgId: string, identityId: string;

const note = (a: Actor, title = 'Note') =>
  a
    .q<{ id: string }>(
      `insert into content_items(type,title,ownership) values ('note',$1,'user') returning id`,
      [title],
    )
    .then((r) => r[0]!.id);
const draft = (
  a: Actor,
  content: string,
  body: unknown = { blocks: [{ type: 'paragraph', text: 'hello world' }] },
) =>
  a
    .q<{ id: string }>(
      `insert into content_versions(content_id, body) values ($1, $2::jsonb) returning id`,
      [content, JSON.stringify(body)],
    )
    .then((r) => r[0]!.id);

beforeAll(async () => {
  db = await freshDb();
  const ids = await Promise.all(
    ['alice', 'bob', 'carol', 'dave', 'mod', 'admin', 'pub'].map((n) =>
      createUser(db, `${n}@example.com`),
    ),
  );
  const [a, b, c, d, m, ad, p] = ids as [string, string, string, string, string, string, string];
  alice = new Actor(db, a);
  bob = new Actor(db, b);
  carol = new Actor(db, c);
  dave = new Actor(db, d);
  mod = new Actor(db, m);
  admin = new Actor(db, ad);
  pub = new Actor(db, p);
  anon = new Actor(db, null, 'anon');
  await grantRole(db, m, 'moderator');
  await grantRole(db, ad, 'admin');
  await grantRole(db, p, 'official_content_creator');
  await grantRole(db, p, 'official_publisher');
  orgId = (
    await db.query<{ id: string }>(
      `insert into organizations(slug,name) values ('learning-loop','Learning Loop') returning id`,
    )
  ).rows[0]!.id;
  identityId = (
    await db.query<{ id: string }>(
      `insert into publishing_identities(organization_id,slug,name,kind) values ($1,'ll-official','Learning Loop Official','human') returning id`,
      [orgId],
    )
  ).rows[0]!.id;
  await db.query(`insert into publishing_identity_members(identity_id,user_id) values ($1,$2)`, [
    identityId,
    p,
  ]);
});

describe('identity & roles', () => {
  it('signup creates a profile and the student role', async () => {
    expect((await alice.q(`select username from profiles where id = auth.uid()`)).length).toBe(1);
    expect(await alice.q(`select role from user_roles where user_id = auth.uid()`)).toEqual([
      { role: 'student' },
    ]);
  });
  it('users cannot grant themselves roles (no privilege escalation)', async () => {
    await alice.fails(`insert into user_roles(user_id, role) values (auth.uid(), 'admin')`);
    await alice.fails(
      `insert into user_roles(user_id, role) values (auth.uid(), 'official_content_creator')`,
    );
    expect(
      await alice.denied(
        `update user_roles set role = 'admin' where user_id = auth.uid() returning role`,
      ),
    ).toBe(true);
  });
  it('moderators cannot grant roles either; admins can, and it is audited', async () => {
    await mod.fails(`insert into user_roles(user_id, role) values ('${bob.id}', 'moderator')`);
    await admin.q(`insert into user_roles(user_id, role) values ('${carol.id}', 'creator')`);
    const log = await db.query(
      `select * from audit_log where action = 'role.grant' and target_id = '${carol.id}'`,
    );
    expect(log.rows.length).toBe(1);
  });
  it('users edit only their own profile and cannot change account_state', async () => {
    await alice.q(`update profiles set bio = 'hi' where id = auth.uid()`);
    expect(
      (await alice.q(`update profiles set bio = 'pwned' where id = '${bob.id}' returning id`))
        .length,
    ).toBe(0);
    await alice.fails(`update profiles set account_state = 'suspended' where id = auth.uid()`);
  });
  it('anonymous callers see nothing', async () => {
    expect(await anon.fails(`select * from profiles`)).toMatch(/permission denied/i);
  });
  it('creator trust/verification cannot be self-assigned', async () => {
    await alice.fails(
      `insert into creator_profiles(user_id, trust_level) values (auth.uid(), 'verified')`,
    );
    await alice.q(`insert into creator_profiles(user_id) values (auth.uid())`);
    await alice.fails(
      `update creator_profiles set trust_level = 'trusted' where user_id = auth.uid()`,
    );
  });
});

describe('user content', () => {
  it('owner drafts privately; others cannot see drafts', async () => {
    const id = await note(alice, 'Alice private draft');
    await draft(alice, id);
    expect((await bob.q(`select id from content_items where id = $1`, [id])).length).toBe(0);
    expect(
      (await bob.q(`select id from content_versions where content_id = $1`, [id])).length,
    ).toBe(0);
    expect((await alice.q(`select id from content_items where id = $1`, [id])).length).toBe(1);
  });
  it('ownership is server-assigned: cannot create content owned by someone else or as official', async () => {
    const r = await alice.q<{ owner_user_id: string }>(
      `insert into content_items(type,title,ownership,owner_user_id) values ('note','x','user','${bob.id}') returning owner_user_id`,
    );
    expect(r[0]!.owner_user_id).toBe(alice.id);
    await alice.fails(
      `insert into content_items(type,title,ownership,owner_org_id,publishing_identity_id) values ('note','fake','official','${orgId}','${identityId}')`,
    );
  });
  it('cannot publish by flipping status; must use publish_content, which marks it for moderation', async () => {
    const id = await note(alice, 'To publish');
    await draft(alice, id);
    await alice.fails(`update content_items set publishing = 'published' where id = $1`, [id]);
    await alice.q(`select publish_content($1)`, [id]);
    const row = (
      await bob.q<{ moderation: string; verification: string }>(
        `select moderation, verification from content_items where id = $1`,
        [id],
      )
    )[0]!;
    expect(row.moderation).toBe('pending_review');
    expect(row.verification).toBe('unverified');
  });
  it('cannot set verification/moderation/ownership fields directly', async () => {
    const id = await note(alice, 'Fields');
    await alice.fails(`update content_items set verification = 'official' where id = $1`, [id]);
    await alice.fails(`update content_items set moderation = 'cleared' where id = $1`, [id]);
    await alice.fails(`update content_items set ownership = 'official' where id = $1`, [id]);
    await alice.fails(`update content_items set owner_user_id = '${bob.id}' where id = $1`, [id]);
  });
  it('others cannot modify or publish my content', async () => {
    const id = await note(alice, 'Mine');
    await draft(alice, id);
    expect(
      (await bob.q(`update content_items set title = 'hacked' where id = $1 returning id`, [id]))
        .length,
    ).toBe(0);
    await bob.fails(`select publish_content($1)`, [id]);
    await bob.fails(`insert into content_versions(content_id, body) values ($1, '{"blocks":[]}')`, [
      id,
    ]);
  });
  it('published versions are immutable; edits create a new numbered version', async () => {
    const id = await note(alice, 'Versioned');
    const v1 = await draft(alice, id);
    await alice.q(`select publish_content($1)`, [id]);
    await alice.fails(`update content_versions set body = '{"blocks":[]}' where id = $1`, [v1]);
    await alice.fails(`update content_versions set state = 'draft' where id = $1`, [v1]);
    const v2 = await draft(alice, id, { blocks: [{ type: 'paragraph', text: 'second' }] });
    const versions = await alice.q<{ version_no: number; state: string }>(
      `select version_no, state from content_versions where content_id = $1 order by version_no`,
      [id],
    );
    expect(versions).toEqual([
      { version_no: 1, state: 'published' },
      { version_no: 2, state: 'draft' },
    ]);
    // repeated edits of the draft do not create more rows
    await alice.q(
      `update content_versions set body = '{"blocks":[{"type":"paragraph","text":"third"}]}' where id = $1`,
      [v2],
    );
    expect(
      (await alice.q(`select 1 from content_versions where content_id = $1`, [id])).length,
    ).toBe(2);
    // a second concurrent draft is rejected
    await alice.fails(
      `insert into content_versions(content_id, body) values ($1, '{"blocks":[]}')`,
      [id],
    );
  });
  it('users cannot forge version numbers or states on insert', async () => {
    const id = await note(alice, 'Forge');
    const r = await alice.q<{ version_no: number }>(
      `insert into content_versions(content_id, body, version_no) values ($1, '{}', 99) returning version_no`,
      [id],
    );
    expect(r[0]!.version_no).toBe(1);
    const id2 = await note(alice, 'Forge2');
    await alice.fails(
      `insert into content_versions(content_id, body, state) values ($1, '{}', 'published')`,
      [id2],
    );
  });
  it('question answer keys are hidden from non-owners and never allowed in the public body', async () => {
    const q = await alice.q<{ id: string }>(
      `insert into content_items(type,title,ownership) values ('question','Q','user') returning id`,
    );
    await alice.fails(
      `insert into content_versions(content_id, body) values ($1, '{"prompt":"p","answer":{"optionId":"a"}}')`,
      [q[0]!.id],
    );
    const vid = await draft(alice, q[0]!.id, {
      type: 'single_choice',
      prompt: 'p',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    });
    await alice.q(
      `insert into content_answer_keys(content_version_id, answer, explanation) values ($1, '{"optionId":"a"}', 'because')`,
      [vid],
    );
    await alice.q(`select publish_content($1)`, [q[0]!.id]);
    expect((await bob.q(`select * from content_answer_keys`)).length).toBe(0);
    expect((await alice.q(`select * from content_answer_keys`)).length).toBe(1);
    // key of a published version is frozen
    await alice.fails(
      `update content_answer_keys set answer = '{"optionId":"b"}' where content_version_id = $1`,
      [vid],
    );
    // bob can read the public body (no answer)
    const body = (
      await bob.q<{ body: Record<string, unknown> }>(
        `select body from content_versions where id = $1`,
        [vid],
      )
    )[0]!.body;
    expect(body).not.toHaveProperty('answer');
  });
  it('soft delete only; hard delete is not possible for users', async () => {
    const id = await note(alice, 'Del');
    expect(
      (await alice.q(`delete from content_items where id = $1 returning id`, [id])).length,
    ).toBe(0);
    await alice.q(`update content_items set publishing = 'deleted' where id = $1`, [id]);
    expect(
      (
        await alice.q<{ deleted_at: unknown }>(
          `select deleted_at from content_items where id = $1`,
          [id],
        )
      )[0]!.deleted_at,
    ).not.toBeNull();
  });
  it('upload rate limit applies', async () => {
    for (let i = 0; i < 20; i++) await note(dave, `n${i}`);
    expect(
      await dave.fails(
        `insert into content_items(type,title,ownership) values ('note','n21','user')`,
      ),
    ).toMatch(/rate_limited/);
  });
});

describe('official publishing', () => {
  const officialEnv = (title: string) =>
    `insert into content_items(type,title,ownership,publishing_identity_id,owner_org_id,hook,format,difficulty) values ('note','${title}','official','${identityId}','${orgId}','curiosity','note',0.4) returning id`;
  it('regular users cannot author official content or use a publishing identity', async () => {
    await bob.fails(officialEnv('fake official'));
    const id = (await pub.q<{ id: string }>(officialEnv('Official note')))[0]!.id;
    expect((await bob.q(`select id from content_items where id = $1`, [id])).length).toBe(0); // draft invisible
    await bob.fails(`select publish_content($1)`, [id]);
  });
  it('official publish needs gates + provenance; then is stamped official, audited and idempotent', async () => {
    const id = (await pub.q<{ id: string }>(officialEnv('Official 2')))[0]!.id;
    const vid = await draft(pub, id);
    expect(await pub.fails(`select publish_content($1)`, [id])).toMatch(/quality gates not passed/);
    await pub.q(
      `insert into content_provenance(content_version_id, generated_by, publishing_identity_id) values ($1,'human',$2)`,
      [vid, identityId],
    );
    // the author may NOT write gate results (no pipeline.run) ...
    await pub.fails(
      `insert into quality_gate_results(content_version_id, gate, passed) values ($1,'schema_valid',true)`,
      [vid],
    );
    // ... and even WITH pipeline.run the author cannot satisfy their own gate (independence)
    await db.query(`insert into user_roles(user_id, role) values ($1,'content_ingestion_worker')`, [
      pub.id,
    ]);
    expect(
      await pub.fails(
        `insert into quality_gate_results(content_version_id, gate, passed) values ($1,'schema_valid',true)`,
        [vid],
      ),
    ).toMatch(/other than the content author/);
    await db.query(
      `delete from user_roles where user_id = $1 and role = 'content_ingestion_worker'`,
      [pub.id],
    );
    // an independent validator (pipeline.run, not an identity member) writes the gates
    const validator = new Actor(db, await createUser(db, 'validator@example.com'));
    await grantRole(db, validator.id!, 'content_ingestion_worker');
    for (const g of [
      'schema_valid',
      'source_valid',
      'license_valid',
      'metadata_valid',
      'answer_keys_valid',
      'duplicate_check_passed',
      'content_quality_check_passed',
    ])
      await validator.q(
        `insert into quality_gate_results(content_version_id, gate, passed) values ($1,$2,true)`,
        [vid, g],
      );
    const first = (
      await pub.q<{ publish_content: string }>(`select publish_content($1, 'k1')`, [id])
    )[0]!.publish_content;
    const again = (
      await pub.q<{ publish_content: string }>(`select publish_content($1, 'k1')`, [id])
    )[0]!.publish_content;
    expect(again).toBe(first);
    const row = (
      await bob.q<{ verification: string; moderation: string }>(
        `select verification, moderation from content_items where id = $1`,
        [id],
      )
    )[0]!;
    expect(row).toEqual({ verification: 'official', moderation: 'none' });
    expect(
      (await db.query(`select 1 from publish_log where content_id = $1`, [id])).rows.length,
    ).toBe(1);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action='content.publish' and target_id = $1`,
          [id],
        )
      ).rows.length,
    ).toBe(1);
  });
  it('AI provenance must record model + prompt version', async () => {
    const id = (await pub.q<{ id: string }>(officialEnv('AI note')))[0]!.id;
    const vid = await draft(pub, id);
    await pub.fails(
      `insert into content_provenance(content_version_id, generated_by) values ($1,'model')`,
      [vid],
    );
  });
  it('a publisher without identity membership cannot publish as that identity', async () => {
    const outsider = new Actor(db, await createUser(db, 'outsider@example.com'));
    await grantRole(db, outsider.id!, 'official_publisher');
    await outsider.fails(officialEnv('outsider'));
  });
});

describe('moderation', () => {
  it('3 distinct reports auto-flag (hide) content; duplicate reports from one user are rejected', async () => {
    const id = await note(alice, 'Reportable');
    await draft(alice, id);
    await alice.q(`select publish_content($1)`, [id]);
    // reporters count at full weight only once their account is >7 days old (H3)
    await db.query(
      `update profiles set created_at = now() - interval '30 days' where id in ($1,$2,$3)`,
      [bob.id, carol.id, dave.id],
    );
    await bob.q(
      `insert into reports(reporter_id,target_kind,target_id,reason) values (auth.uid(),'content',$1,'spam')`,
      [id],
    );
    await bob.fails(
      `insert into reports(reporter_id,target_kind,target_id,reason) values (auth.uid(),'content',$1,'spam')`,
      [id],
    );
    await carol.q(
      `insert into reports(reporter_id,target_kind,target_id,reason) values (auth.uid(),'content',$1,'spam')`,
      [id],
    );
    expect((await dave.q(`select id from content_items where id = $1`, [id])).length).toBe(1);
    await dave.q(
      `insert into reports(reporter_id,target_kind,target_id,reason) values (auth.uid(),'content',$1,'harassment')`,
      [id],
    );
    expect((await bob.q(`select id from content_items where id = $1`, [id])).length).toBe(0);
    expect((await alice.q(`select id from content_items where id = $1`, [id])).length).toBe(1);
  });
  it('reporters cannot impersonate other reporters', async () => {
    const id = await note(alice, 'X');
    await bob.fails(
      `insert into reports(reporter_id,target_kind,target_id,reason) values ('${carol.id}','content',$1,'spam')`,
      [id],
    );
  });
  it('only moderators act; actions change state via the server function and are audited', async () => {
    const id = await note(alice, 'Bad content');
    await draft(alice, id);
    await alice.q(`select publish_content($1)`, [id]);
    await bob.fails(`select apply_moderation_action('content', $1, 'remove', 'because')`, [id]);
    await alice.fails(`select apply_moderation_action('content', $1, 'approve', 'self approve')`, [
      id,
    ]);
    await mod.q(`select apply_moderation_action('content', $1, 'remove', 'violates policy')`, [id]);
    expect((await bob.q(`select id from content_items where id = $1`, [id])).length).toBe(0);
    // the owner of removed content cannot clear the removal themselves
    expect(
      await alice.denied(
        `update content_items set moderation = 'cleared' where id = $1 returning id`,
        [id],
      ),
    ).toBe(true);
    await alice.fails(`select publish_content($1)`, [id]);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action = 'moderation.remove' and target_id = $1`,
          [id],
        )
      ).rows.length,
    ).toBe(1);
  });
  it('audit log is readable only with audit.read and is append-only', async () => {
    expect((await bob.q(`select * from audit_log`)).length).toBe(0);
    expect((await admin.q(`select * from audit_log`)).length).toBeGreaterThan(0);
    await expect(db.query(`update audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
  });
  it("users cannot read moderation cases or other people's reports", async () => {
    expect((await bob.q(`select * from moderation_cases`)).length).toBe(0);
    expect((await dave.q(`select * from reports where reporter_id = '${bob.id}'`)).length).toBe(0);
    expect((await mod.q(`select * from moderation_cases`)).length).toBeGreaterThan(0);
  });
});

describe('blocking & social', () => {
  it("blocked users cannot see each other's content", async () => {
    const id = await note(carol, 'Carol public');
    await draft(carol, id);
    await carol.q(`select publish_content($1)`, [id]);
    expect((await dave.q(`select id from content_items where id = $1`, [id])).length).toBe(1);
    await carol.q(
      `insert into user_blocks(blocker_id, blocked_id) values (auth.uid(), '${dave.id}')`,
    );
    expect((await dave.q(`select id from content_items where id = $1`, [id])).length).toBe(0);
    expect((await dave.q(`select * from user_blocks`)).length).toBe(0); // blocked user cannot learn they are blocked
    await dave.fails(
      `insert into follows(follower_id, followee_id) values (auth.uid(), '${carol.id}')`,
    );
  });
  it('likes/saves are own-only and maintain counters', async () => {
    const id = await note(alice, 'Likeable');
    await draft(alice, id);
    await alice.q(`select publish_content($1)`, [id]);
    await bob.q(`insert into likes(user_id, content_id) values (auth.uid(), $1)`, [id]);
    await bob.fails(`insert into likes(user_id, content_id) values ('${carol.id}', $1)`, [id]);
    expect(
      (
        await bob.q<{ like_count: number }>(
          `select like_count from content_stats where content_id = $1`,
          [id],
        )
      )[0]!.like_count,
    ).toBe(1);
    expect((await carol.q(`select * from likes`)).length).toBe(0);
    await bob.q(`delete from likes where content_id = $1`, [id]);
    expect(
      (
        await bob.q<{ like_count: number }>(
          `select like_count from content_stats where content_id = $1`,
          [id],
        )
      )[0]!.like_count,
    ).toBe(0);
  });
  it('comments cannot be posted as another user or on invisible content', async () => {
    const id = await note(alice, 'Hidden draft');
    await bob.fails(
      `insert into comments(content_id, user_id, body) values ($1, auth.uid(), 'hi')`,
      [id],
    );
    await draft(alice, id);
    await alice.q(`select publish_content($1)`, [id]);
    await bob.fails(
      `insert into comments(content_id, user_id, body) values ($1, '${carol.id}', 'impersonate')`,
      [id],
    );
    await bob.q(`insert into comments(content_id, user_id, body) values ($1, auth.uid(), 'nice')`, [
      id,
    ]);
  });
});

describe('messaging', () => {
  let conv: string;
  it('cannot start a conversation unless the recipient allows it; blocks and nobody-policy are enforced', async () => {
    await bob.fails(`select start_direct_conversation('${alice.id}')`); // default dm_policy=followers, no follow
    await bob.q(`insert into follows(follower_id, followee_id) values (auth.uid(), '${alice.id}')`);
    conv = (
      await bob.q<{ start_direct_conversation: string }>(
        `select start_direct_conversation('${alice.id}')`,
      )
    )[0]!.start_direct_conversation;
    const again = (
      await alice.q<{ start_direct_conversation: string }>(
        `select start_direct_conversation('${bob.id}')`,
      )
    )[0]!.start_direct_conversation;
    expect(again).toBe(conv); // 1:1 thread dedupe
    await alice.q(`update profiles set dm_policy = 'nobody' where id = auth.uid()`);
    await carol.fails(`select start_direct_conversation('${alice.id}')`);
    await alice.q(`update profiles set dm_policy = 'followers' where id = auth.uid()`);
  });
  it('clients cannot create conversations or add members directly', async () => {
    await eve().fails(`insert into conversations(kind) values ('direct')`);
    await bob.fails(
      `insert into conversation_members(conversation_id, user_id) values ('${conv}', '${carol.id}')`,
    );
  });
  it('only members read/send; others see nothing', async () => {
    await bob.q(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'hello')`,
      [conv],
    );
    expect(
      (await alice.q(`select * from messages where conversation_id = $1`, [conv])).length,
    ).toBe(1);
    expect((await carol.q(`select * from messages`)).length).toBe(0);
    await carol.fails(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'intrude')`,
      [conv],
    );
    await bob.fails(
      `insert into messages(conversation_id, sender_id, body) values ($1, '${alice.id}', 'spoof')`,
      [conv],
    );
  });
  it('messages are immutable except soft-delete by the sender', async () => {
    const m = (
      await bob.q<{ id: string }>(`select id from messages where conversation_id = $1`, [conv])
    )[0]!.id;
    await bob.fails(`update messages set body = 'edited' where id = $1`, [m]);
    expect(
      (await alice.q(`update messages set deleted_at = now() where id = $1 returning id`, [m]))
        .length,
    ).toBe(0);
  });
  it('a blocked user cannot keep messaging via the old conversation', async () => {
    await alice.q(
      `insert into user_blocks(blocker_id, blocked_id) values (auth.uid(), '${bob.id}')`,
    );
    await bob.fails(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'still here?')`,
      [conv],
    );
    await bob.fails(`select start_direct_conversation('${alice.id}')`);
  });
  it('message rate limit applies', async () => {
    const x = await createUser(db, 'spammer@example.com'),
      y = await createUser(db, 'target@example.com');
    const sx = new Actor(db, x),
      sy = new Actor(db, y);
    await sy.q(`update profiles set dm_policy = 'everyone' where id = auth.uid()`);
    const c = (
      await sx.q<{ start_direct_conversation: string }>(`select start_direct_conversation('${y}')`)
    )[0]!.start_direct_conversation;
    for (let i = 0; i < 30; i++)
      await sx.q(
        `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'm')`,
        [c],
      );
    expect(
      await sx.fails(
        `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'm')`,
        [c],
      ),
    ).toMatch(/rate_limited/);
  });
  const eve = () => carol;
});

describe('learning integrity & privacy', () => {
  it('clients cannot forge attempts, mastery, reviews or XP', async () => {
    const q = await note(alice, 'q');
    await draft(alice, q);
    const vid = (
      await alice.q<{ id: string }>(`select id from content_versions where content_id = $1`, [q])
    )[0]!.id;
    await alice.fails(
      `insert into question_attempts(user_id, question_id, content_version_id, response, correct, score) values (auth.uid(), '${q}', '${vid}', '{}', true, 1)`,
    );
    await alice.fails(
      `insert into concept_mastery(user_id, concept_id, alpha) values (auth.uid(), gen_random_uuid(), 99)`,
    );
    await alice.fails(
      `insert into xp_ledger(user_id, action, amount, idempotency_key) values (auth.uid(), 'x', 1000000, 'k')`,
    );
    await alice.fails(
      `insert into user_progress(user_id, xp, level) values (auth.uid(), 99999, 50)`,
    );
  });
  it('learner profile: own data only; derived fields are server-managed', async () => {
    await alice.q(`insert into learner_profiles(user_id, interests) values (auth.uid(), '{math}')`);
    await alice.fails(`update learner_profiles set ability = 0.99 where user_id = auth.uid()`);
    // a fresh learner cannot self-assign a derived ability at insert time either (RLS check ability = 0.5)
    await bob.fails(`insert into learner_profiles(user_id, ability) values (auth.uid(), 0.9)`);
    expect((await bob.q(`select * from learner_profiles`)).length).toBe(0);
  });
  it('events: clients cannot insert at all (sanitised server path only); nobody reads others events', async () => {
    await db.query(`insert into events(user_id, name, payload) values ($1, 'like', '{}')`, [
      alice.id,
    ]);
    await alice.fails(
      `insert into events(user_id, name, payload) values (auth.uid(), 'like', '{}')`,
    );
    await alice.fails(
      `insert into events(user_id, name, payload) values ('${bob.id}', 'like', '{}')`,
    );
    expect((await bob.q(`select * from events`)).length).toBe(0);
    expect((await alice.q(`select * from events`)).length).toBe(1);
  });
  it('recommendation features, diagnostics and why_shown are staff-only', async () => {
    await db.query(`insert into user_features(user_id, features) values ($1, '{}')`, [alice.id]);
    expect((await alice.q(`select * from user_features`)).length).toBe(0);
    expect((await admin.q(`select * from user_features`)).length).toBe(1); // admin has analytics.read
    await db.query(
      `insert into user_roles(user_id, role) values ('${bob.id}', 'analytics_worker')`,
    );
    expect((await bob.q(`select * from user_features`)).length).toBe(1);
    await alice.fails(
      `insert into ranking_versions(version, algorithm, status) values ('ranking_v9','{}','active')`,
    );
    await alice.fails(
      `insert into experiments(key, hypothesis, variants) values ('hack','x','[]')`,
    );
    expect(
      (
        await alice.q(
          `update feature_flags set enabled = true where key = 'local_ai' returning key`,
        )
      ).length,
    ).toBe(0);
  });
  it('sources and pipeline are staff-only; term changes are audited', async () => {
    expect((await alice.q(`select * from sources`)).length).toBe(0);
    await alice.fails(`insert into sources(slug,name,url) values ('s','S','https://x.org')`);
    const id = (
      await admin.q<{ id: string }>(
        `insert into sources(slug,name,url,license) values ('open-physics','Open Physics','https://openphysics.example','cc_by') returning id`,
      )
    )[0]!.id;
    await admin.q(`update sources set license = 'proprietary' where id = $1`, [id]);
    expect(
      (
        await db.query(
          `select 1 from audit_log where action = 'source.terms_changed' and target_id = $1`,
          [id],
        )
      ).rows.length,
    ).toBe(1);
    await alice.fails(
      `insert into pipeline_jobs(kind, idempotency_key) values ('fetch_source','k')`,
    );
  });
  it('pipeline jobs are idempotent and enforce the state machine', async () => {
    const mk = (k: string) =>
      admin.q<{ id: string }>(
        `insert into pipeline_jobs(kind, idempotency_key) values ('fetch_source', $1) returning id`,
        [k],
      );
    const j = (await mk('same'))[0]!.id;
    await admin.fails(
      `insert into pipeline_jobs(kind, idempotency_key) values ('fetch_source', 'same')`,
    );
    await admin.fails(`update pipeline_jobs set status = 'completed' where id = $1`, [j]);
    await admin.q(`update pipeline_jobs set status = 'running' where id = $1`, [j]);
    await admin.q(`update pipeline_jobs set status = 'completed' where id = $1`, [j]);
    await admin.fails(`update pipeline_jobs set status = 'running' where id = $1`, [j]);
  });
});

describe('storage', () => {
  it('bucket is private with MIME + size limits; uploads are scoped to the owner path; reads respect content visibility', async () => {
    const b = (
      await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
        `select * from storage.buckets where id = 'media'`,
      )
    ).rows[0]!;
    expect(b.public).toBe(false);
    expect(b.allowed_mime_types).not.toContain('text/html');
    await alice.q(
      `insert into storage.objects(bucket_id, name, owner) values ('media', auth.uid()::text || '/m1/original.jpg', auth.uid())`,
    );
    await alice.fails(
      `insert into storage.objects(bucket_id, name, owner) values ('media', '${bob.id}/m1/original.jpg', auth.uid())`,
    );
    expect(
      (await bob.q(`select * from storage.objects where name like '${alice.id}/%'`)).length,
    ).toBe(0); // not attached to visible content
  });
});
