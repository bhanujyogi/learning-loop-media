import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { Actor, createUser, freshDb, grantRole } from './harness';

/** Regression tests for the 2026-10-01 audit (C1, C2, H1, H2, H3 + medium hardening). Each reproduces the original attack. */
let db: PGlite;
const IDENTITY = '00000000-0000-0000-0000-0000000000b1';
const ORG = '00000000-0000-0000-0000-0000000000a1';
const GATES = [
  'schema_valid',
  'source_valid',
  'license_valid',
  'metadata_valid',
  'answer_keys_valid',
  'duplicate_check_passed',
  'content_quality_check_passed',
];

const mk = async (email: string) => new Actor(db, await createUser(db, email));
const age = (a: Actor) =>
  db.query(`update profiles set created_at = now() - interval '30 days' where id = $1`, [a.id]);
const userNote = async (a: Actor, publish = true) => {
  const id = (
    await a.q<{ id: string }>(
      `insert into content_items(type,title,ownership) values ('note','Title','user') returning id`,
    )
  )[0]!.id;
  await a.q(`insert into content_versions(content_id, body) values ($1, '{"blocks":[]}')`, [id]);
  if (publish) await a.q(`select publish_content($1)`, [id]);
  return id;
};
const report = (a: Actor, target: string) =>
  a.q(
    `insert into reports(reporter_id,target_kind,target_id,reason) values (auth.uid(),'content',$1,'spam')`,
    [target],
  );

beforeAll(async () => {
  db = await freshDb();
  await db.exec(`
    insert into organizations(id, slug, name) values ('${ORG}', 'learning-loop', 'Learning Loop');
    insert into publishing_identities(id, organization_id, slug, name, kind) values ('${IDENTITY}', '${ORG}', 'll-official', 'Official', 'human');`);
});

describe('C1 conversation membership cannot be re-pointed', () => {
  it('a member cannot move their row into another conversation to read its messages', async () => {
    const [a, b, e] = [await mk('c1a@x.io'), await mk('c1b@x.io'), await mk('c1e@x.io')];
    await b.q(`update profiles set dm_policy='everyone' where id=auth.uid()`);
    await a.q(`update profiles set dm_policy='everyone' where id=auth.uid()`);
    const victim = (await a.q<{ c: string }>(`select start_direct_conversation('${b.id}') c`))[0]!
      .c;
    await a.q(
      `insert into messages(conversation_id,sender_id,body) values ($1,auth.uid(),'secret')`,
      [victim],
    );
    const mine = (await e.q<{ c: string }>(`select start_direct_conversation('${a.id}') c`))[0]!.c;
    expect(
      await e.fails(
        `update conversation_members set conversation_id=$1 where conversation_id=$2 and user_id=auth.uid()`,
        [victim, mine],
      ),
    ).toMatch(/immutable/);
    expect((await e.q(`select body from messages where conversation_id=$1`, [victim])).length).toBe(
      0,
    );
  });
  it('cannot change user_id or escalate member_role; read/leave state still works', async () => {
    const [a, b] = [await mk('c1c@x.io'), await mk('c1d@x.io')];
    await b.q(`update profiles set dm_policy='everyone' where id=auth.uid()`);
    const c = (await a.q<{ c: string }>(`select start_direct_conversation('${b.id}') c`))[0]!.c;
    await a.fails(
      `update conversation_members set member_role='admin' where conversation_id=$1 and user_id=auth.uid()`,
      [c],
    );
    await a.fails(
      `update conversation_members set user_id='${b.id}' where conversation_id=$1 and user_id=auth.uid()`,
      [c],
    );
    expect(
      (
        await a.q(
          `update conversation_members set last_read_at = now() where conversation_id=$1 and user_id=auth.uid() returning 1`,
          [c],
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await a.q(
          `update conversation_members set left_at = now() where conversation_id=$1 and user_id=auth.uid() returning 1`,
          [c],
        )
      ).length,
    ).toBe(1);
  });
  it('message timestamps are server-assigned', async () => {
    const [a, b] = [await mk('c1e2@x.io'), await mk('c1f@x.io')];
    await b.q(`update profiles set dm_policy='everyone' where id=auth.uid()`);
    const c = (await a.q<{ c: string }>(`select start_direct_conversation('${b.id}') c`))[0]!.c;
    const r = await a.q<{ old: boolean }>(
      `insert into messages(conversation_id,sender_id,body,created_at) values ($1,auth.uid(),'x', now() - interval '10 years') returning (created_at < now() - interval '1 day') old`,
      [c],
    );
    expect(r[0]!.old).toBe(false);
  });
});

describe('C2 gates are bound to the exact content that was validated', () => {
  const setup = async (tag: string) => {
    const author = await mk(`c2author-${tag}@x.io`);
    await grantRole(db, author.id!, 'official_content_creator');
    await grantRole(db, author.id!, 'official_publisher');
    await db.query(`insert into publishing_identity_members values ($1,$2)`, [IDENTITY, author.id]);
    const validator = await mk(`c2val-${tag}@x.io`);
    await grantRole(db, validator.id!, 'content_ingestion_worker');
    const id = (
      await author.q<{ id: string }>(
        `insert into content_items(type,title,ownership,publishing_identity_id) values ('note','Official','official','${IDENTITY}') returning id`,
      )
    )[0]!.id;
    const vid = (
      await author.q<{ id: string }>(
        `insert into content_versions(content_id, body) values ($1,'{"blocks":[{"type":"paragraph","text":"validated text"}]}') returning id`,
        [id],
      )
    )[0]!.id;
    await author.q(
      `insert into content_provenance(content_version_id, generated_by, publishing_identity_id) values ($1,'human',$2)`,
      [vid, IDENTITY],
    );
    return { author, validator, id, vid };
  };
  const gate = async (v: Actor, vid: string) => {
    for (const g of GATES)
      await v.q(
        `insert into quality_gate_results(content_version_id, gate, passed) values ($1,$2,true) on conflict (content_version_id, gate) do update set passed = true`,
        [vid, g],
      );
  };

  it('swapping the body after the gates pass makes publish fail; re-validation allows it', async () => {
    const { author, validator, id, vid } = await setup('body');
    await gate(validator, vid);
    await author.q(
      `update content_versions set body='{"blocks":[{"type":"paragraph","text":"SWAPPED UNVALIDATED"}]}' where id=$1`,
      [vid],
    );
    expect(await author.fails(`select publish_content($1)`, [id])).toMatch(/stale|not passed/);
    await gate(validator, vid); // validator re-checks the changed content
    await author.q(`select publish_content($1)`, [id]);
    expect(
      (
        await db.query<{ verification: string }>(
          `select verification from content_items where id=$1`,
          [id],
        )
      ).rows[0]!.verification,
    ).toBe('official');
  });
  it('editing metadata, provenance or concept links after gating also invalidates the gates', async () => {
    const { author, validator, id, vid } = await setup('meta');
    await gate(validator, vid);
    await author.q(`update content_items set title='Different title' where id=$1`, [id]);
    expect(await author.fails(`select publish_content($1)`, [id])).toMatch(/stale|not passed/);
    await gate(validator, vid);
    await author.q(
      `update content_provenance set model_identifier='sneaky' where content_version_id=$1`,
      [vid],
    );
    expect(await author.fails(`select publish_content($1)`, [id])).toMatch(/stale|not passed/);
  });
  it('the author (even with pipeline.run) cannot satisfy a gate; the hash is assigned server-side', async () => {
    const { author, validator, vid } = await setup('indep');
    await grantRole(db, author.id!, 'content_ingestion_worker');
    expect(
      await author.fails(
        `insert into quality_gate_results(content_version_id, gate, passed) values ($1,'schema_valid',true)`,
        [vid],
      ),
    ).toMatch(/other than the content author/);
    // a validator cannot pre-compute / lie about the hash
    await validator.q(
      `insert into quality_gate_results(content_version_id, gate, passed, content_hash) values ($1,'schema_valid',true,'deadbeef')`,
      [vid],
    );
    const h = (
      await db.query<{ content_hash: string; checked_by: string }>(
        `select content_hash, checked_by from quality_gate_results where content_version_id=$1`,
        [vid],
      )
    ).rows[0]!;
    expect(h.content_hash).not.toBe('deadbeef');
    expect(h.checked_by).toBe(validator.id);
  });
  it('valid gates without provenance still cannot publish', async () => {
    const author = await mk('c2np@x.io');
    await grantRole(db, author.id!, 'official_content_creator');
    await grantRole(db, author.id!, 'official_publisher');
    await db.query(`insert into publishing_identity_members values ($1,$2)`, [IDENTITY, author.id]);
    const validator = await mk('c2npv@x.io');
    await grantRole(db, validator.id!, 'content_ingestion_worker');
    const id = (
      await author.q<{ id: string }>(
        `insert into content_items(type,title,ownership,publishing_identity_id) values ('note','NoProv','official','${IDENTITY}') returning id`,
      )
    )[0]!.id;
    const vid = (
      await author.q<{ id: string }>(
        `insert into content_versions(content_id, body) values ($1,'{"blocks":[]}') returning id`,
        [id],
      )
    )[0]!.id;
    await gate(validator, vid);
    expect(await author.fails(`select publish_content($1)`, [id])).toMatch(/requires provenance/);
  });
});

describe('H1 material edits to cleared content return it to review', () => {
  const approve = async (a: Actor, id: string) => {
    const m = await mk(`h1mod-${id.slice(0, 6)}@x.io`);
    await grantRole(db, m.id!, 'moderator');
    await m.q(`select apply_moderation_action('content',$1,'approve','approved after review')`, [
      id,
    ]);
  };
  const mod = async (id: string) =>
    (
      await db.query<{ moderation: string }>(`select moderation from content_items where id=$1`, [
        id,
      ])
    ).rows[0]!.moderation;
  it('a title change after approval re-enters pending_review', async () => {
    const a = await mk('h1a@x.io');
    const id = await userNote(a);
    await approve(a, id);
    expect(await mod(id)).toBe('cleared');
    await a.q(`update content_items set title='abusive title' where id=$1`, [id]);
    expect(await mod(id)).toBe('pending_review');
  });
  it('a new published version after approval re-enters pending_review (untrusted creator)', async () => {
    const a = await mk('h1b@x.io');
    const id = await userNote(a);
    await approve(a, id);
    await a.q(
      `insert into content_versions(content_id, body) values ($1,'{"blocks":[{"type":"paragraph","text":"new"}]}')`,
      [id],
    );
    await a.q(`select publish_content($1)`, [id]);
    expect(await mod(id)).toBe('pending_review');
  });
  it('trusted creators keep clearance on new versions; unchanged saves never reset it', async () => {
    const a = await mk('h1c@x.io');
    const id = await userNote(a);
    await approve(a, id);
    await a.q(`update content_items set expected_seconds = 30 where id=$1`, [id]); // not a material text change
    expect(await mod(id)).toBe('cleared');
    await a.q(`insert into creator_profiles(user_id) values (auth.uid())`);
    const admin = await mk('h1admin@x.io');
    await grantRole(db, admin.id!, 'admin');
    await admin.q(`update creator_profiles set trust_level='trusted' where user_id=$1`, [a.id]);
    await a.q(
      `insert into content_versions(content_id, body) values ($1,'{"blocks":[{"type":"paragraph","text":"v2"}]}')`,
      [id],
    );
    await a.q(`select publish_content($1)`, [id]);
    expect(await mod(id)).toBe('cleared');
  });
  it('a removed item cannot be revived by editing', async () => {
    const a = await mk('h1d@x.io');
    const id = await userNote(a);
    const m = await mk('h1dm@x.io');
    await grantRole(db, m.id!, 'moderator');
    await m.q(`select apply_moderation_action('content',$1,'remove','bad')`, [id]);
    await a.fails(`update content_items set moderation='cleared' where id=$1`, [id]);
    await a.fails(`select publish_content($1)`, [id]);
  });
});

describe('H3 weighted reports; throwaway accounts cannot hide content', () => {
  const mod = async (id: string) =>
    (
      await db.query<{ moderation: string }>(`select moderation from content_items where id=$1`, [
        id,
      ])
    ).rows[0]!.moderation;
  it('three brand-new accounts do NOT auto-hide user content, but the case is queued with priority', async () => {
    const owner = await mk('h3o1@x.io');
    const id = await userNote(owner);
    for (let i = 0; i < 3; i++) await report(await mk(`h3n${i}@x.io`), id);
    expect(await mod(id)).toBe('pending_review');
    const c = (
      await db.query<{ priority: number }>(
        `select priority from moderation_cases where target_id=$1`,
        [id],
      )
    ).rows[0]!;
    expect(c.priority).toBeGreaterThan(0);
  });
  it('three established accounts do flag user content (reports still work)', async () => {
    const owner = await mk('h3o2@x.io');
    const id = await userNote(owner);
    for (let i = 0; i < 3; i++) {
      const r = await mk(`h3e${i}@x.io`);
      await age(r);
      await report(r, id);
    }
    expect(await mod(id)).toBe('flagged');
    expect(
      (await (await mk('h3viewer@x.io')).q(`select id from content_items where id=$1`, [id]))
        .length,
    ).toBe(0);
  });
  it('official content is never auto-hidden, even by many established reporters; the case is escalated', async () => {
    const pub = await mk('h3pub@x.io');
    await grantRole(db, pub.id!, 'official_content_creator');
    await db.query(`insert into publishing_identity_members values ($1,$2)`, [IDENTITY, pub.id]);
    const id = (
      await db.query<{ id: string }>(
        `insert into content_items(type,title,ownership,owner_org_id,publishing_identity_id,publishing,verification) values ('note','Official','official','${ORG}','${IDENTITY}','published','official') returning id`,
      )
    ).rows[0]!.id;
    for (let i = 0; i < 6; i++) {
      const r = await mk(`h3of${i}@x.io`);
      await age(r);
      await report(r, id);
    }
    expect(await mod(id)).toBe('none');
    const c = (
      await db.query<{ escalated: boolean }>(
        `select escalated from moderation_cases where target_id=$1`,
        [id],
      )
    ).rows[0]!;
    expect(c.escalated).toBe(true);
  });
  it('human-approved (cleared) content is not auto-hidden either; reporters cannot set their own weight', async () => {
    const owner = await mk('h3o3@x.io');
    const id = await userNote(owner);
    const m = await mk('h3m@x.io');
    await grantRole(db, m.id!, 'moderator');
    await m.q(`select apply_moderation_action('content',$1,'approve','approved after review')`, [
      id,
    ]);
    for (let i = 0; i < 4; i++) {
      const r = await mk(`h3c${i}@x.io`);
      await age(r);
      await report(r, id);
    }
    expect(await mod(id)).toBe('cleared');
    const fresh = await mk('h3w@x.io');
    await fresh.q(
      `insert into reports(reporter_id,target_kind,target_id,reason,weight) values (auth.uid(),'content',$1,'spam',1)`,
      [id],
    );
    expect(
      (
        await db.query<{ weight: number }>(`select weight from reports where reporter_id=$1`, [
          fresh.id,
        ])
      ).rows[0]!.weight,
    ).toBeLessThan(0.5);
  });
});

describe('H2 clients cannot write analytics events', () => {
  it('direct insert is denied for every client role; payload injection impossible', async () => {
    const a = await mk('h2a@x.io');
    expect(
      await a.fails(
        `insert into events(user_id,name,payload) values (auth.uid(),'skip','{"content_id":"x","immediate":true,"email":"v@x.io"}')`,
      ),
    ).toMatch(/permission denied|row-level security/);
    expect((await a.q(`select * from events`)).length).toBe(0);
  });
});

describe('medium hardening', () => {
  it('public handles do not leak the email address; reserved names and is_creator are protected', async () => {
    const a = await mk('john.smith.private@x.io');
    const p = (
      await a.q<{ username: string }>(`select username from profiles where id=auth.uid()`)
    )[0]!;
    expect(p.username).not.toMatch(/john|smith|private/);
    await a.fails(`update profiles set username='learningloop_official' where id=auth.uid()`);
    await a.fails(`update profiles set username='admin' where id=auth.uid()`);
    await a.fails(`update profiles set is_creator=true where id=auth.uid()`);
    await a.q(`update profiles set username='ravi_kumar_21' where id=auth.uid()`);
  });
  it("media rows cannot reference another user's key or content", async () => {
    const [a, b] = [await mk('m1a@x.io'), await mk('m1b@x.io')];
    const mine = await userNote(a, false);
    await b.fails(
      `insert into media_assets(owner_user_id,bucket,storage_key,mime_type,size_bytes) values (auth.uid(),'media','${a.id}/x/original.pdf','application/pdf',10)`,
    );
    await b.fails(
      `insert into media_assets(owner_user_id,bucket,storage_key,mime_type,size_bytes) values (auth.uid(),'media', auth.uid()::text || '/../${a.id}/x.pdf','application/pdf',10)`,
    );
    await b.fails(
      `insert into media_assets(owner_user_id,content_id,bucket,storage_key,mime_type,size_bytes) values (auth.uid(),$1,'media', auth.uid()::text || '/x/original.pdf','application/pdf',10)`,
      [mine],
    );
    await b.q(
      `insert into media_assets(owner_user_id,bucket,storage_key,mime_type,size_bytes) values (auth.uid(),'media', auth.uid()::text || '/x/original.pdf','application/pdf',10)`,
    );
  });
  it('moderators cannot read private drafts but can read published/reported material', async () => {
    const a = await mk('mod1a@x.io');
    const m = await mk('mod1m@x.io');
    await grantRole(db, m.id!, 'moderator');
    const draft = await userNote(a, false);
    const pubd = await userNote(a, true);
    expect((await m.q(`select id from content_items where id=$1`, [draft])).length).toBe(0);
    expect((await m.q(`select id from content_versions where content_id=$1`, [draft])).length).toBe(
      0,
    );
    expect((await m.q(`select id from content_items where id=$1`, [pubd])).length).toBe(1);
  });
});

describe('client privilege hardening (found during hosted verification)', () => {
  it('authenticated holds no TRUNCATE/REFERENCES/TRIGGER on public tables and no write privilege on server-written tables', async () => {
    const db = await freshDb();
    const trunc = await db.query<{ t: string }>(
      `select c.relname t from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
         and (has_table_privilege('authenticated', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'REFERENCES')
              or has_table_privilege('authenticated', c.oid, 'TRIGGER'))`,
    );
    expect(trunc.rows).toEqual([]);
    const writable = await db.query<{ t: string }>(
      `select c.relname t from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
         and c.relname in ('question_attempts','concept_mastery','xp_ledger','user_features','review_items','review_history',
                           'user_progress','events','audit_log','content_quality_signals','recommendations','content_stats')
         and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
              or has_table_privilege('authenticated', c.oid, 'DELETE'))`,
    );
    expect(writable.rows).toEqual([]);
  });
});
