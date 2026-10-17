import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { Actor, createUser, freshDb } from './harness';

let db: PGlite, a: Actor, b: Actor, c: Actor, d: Actor;
beforeEach(async () => {
  db = await freshDb();
  const ids = await Promise.all(
    ['a', 'b', 'c', 'd'].map((n) => createUser(db, `${n}@example.com`)),
  );
  [a, b, c, d] = ids.map((id) => new Actor(db, id)) as [Actor, Actor, Actor, Actor];
});
const befriend = async (x: Actor, y: Actor) => {
  await x.q(`select send_friend_request($1)`, [y.id]);
  const req = (
    await y.q<{ id: string }>(
      `select id from friend_requests where to_user = auth.uid() and status = 'pending'`,
    )
  )[0]!;
  await y.q(`select respond_friend_request($1, true)`, [req.id]);
};

describe('friend requests', () => {
  it('a request is pending until accepted; accepting makes both follow each other (friends)', async () => {
    expect((await a.q<{ s: string }>(`select send_friend_request($1) s`, [b.id]))[0]!.s).toBe(
      'pending',
    );
    expect((await a.q<{ s: string }>(`select send_friend_request($1) s`, [b.id]))[0]!.s).toBe(
      'pending',
    ); // idempotent
    expect(await a.q(`select 1 from follows`)).toHaveLength(0);
    const req = (
      await b.q<{ id: string }>(`select id from friend_requests where to_user = auth.uid()`)
    )[0]!;
    expect(
      (await b.q<{ s: string }>(`select respond_friend_request($1, true) s`, [req.id]))[0]!.s,
    ).toBe('friends');
    const f = await db.query(
      `select 1 from follows where (follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)`,
      [a.id, b.id],
    );
    expect(f.rows).toHaveLength(2);
  });
  it('asking someone who already asked you simply makes you friends; declining creates no follow; only the recipient can respond', async () => {
    await a.q(`select send_friend_request($1)`, [b.id]);
    expect((await b.q<{ s: string }>(`select send_friend_request($1) s`, [a.id]))[0]!.s).toBe(
      'friends',
    );
    await c.q(`select send_friend_request($1)`, [d.id]);
    const req = (
      await d.q<{ id: string }>(`select id from friend_requests where to_user = auth.uid()`)
    )[0]!;
    await a.fails(`select respond_friend_request($1, true)`, [req.id]); // a is not the recipient
    await d.q(`select respond_friend_request($1, false)`, [req.id]);
    expect(
      (await db.query(`select 1 from follows where follower_id in ($1,$2)`, [c.id, d.id])).rows,
    ).toHaveLength(0);
  });
  it('clients cannot write friend_requests or follow-for-someone-else directly, and blocked users cannot ask', async () => {
    await a.fails(`insert into friend_requests(from_user, to_user) values (auth.uid(), '${b.id}')`);
    await a.fails(`insert into follows(follower_id, followee_id) values ('${b.id}', '${a.id}')`);
    await b.q(`insert into user_blocks(blocker_id, blocked_id) values (auth.uid(), '${a.id}')`);
    await a.fails(`select send_friend_request($1)`, [b.id]);
  });
});

describe('groups and inbox', () => {
  it('friends can create a group and chat; non-friends cannot be added; strangers cannot read it', async () => {
    await befriend(a, b);
    await befriend(a, c);
    const gid = (
      await a.q<{ g: string }>(
        `select create_group('Maths doubts', array['${b.id}','${c.id}']::uuid[]) g`,
      )
    )[0]!.g;
    await a.fails(`select create_group('Nope', array['${d.id}']::uuid[])`); // d is not a friend
    await b.q(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'hello group')`,
      [gid],
    );
    expect(await c.q(`select body from messages where conversation_id = $1`, [gid])).toHaveLength(
      1,
    );
    expect(await d.q(`select body from messages where conversation_id = $1`, [gid])).toHaveLength(
      0,
    );
    await d.fails(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'let me in')`,
      [gid],
    );
    const inbox = (
      await c.q<{
        j: Array<{ title: string; unread: number; lastBody: string; members: unknown[] }>;
      }>(`select my_conversations() j`)
    )[0]!.j;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ title: 'Maths doubts', unread: 1, lastBody: 'hello group' });
    expect(inbox[0]!.members).toHaveLength(2);
  });
  it('only a group admin adds members, and only friends of theirs', async () => {
    await befriend(a, b);
    await befriend(a, d);
    const gid = (
      await a.q<{ g: string }>(`select create_group('Study', array['${b.id}']::uuid[]) g`)
    )[0]!.g;
    await b.fails(`select add_group_member($1, $2)`, [gid, d.id]); // b is a plain member
    await a.q(`select add_group_member($1, $2)`, [gid, d.id]);
    await a.fails(`select add_group_member($1, $2)`, [gid, c.id]); // c is not a's friend
  });
  it('friends can start a direct chat; a share is just a message', async () => {
    await befriend(a, b);
    const cid = (await a.q<{ c: string }>(`select start_direct_conversation($1) c`, [b.id]))[0]!.c;
    await a.q(
      `insert into messages(conversation_id, sender_id, body) values ($1, auth.uid(), 'll:content:123e4567-e89b-12d3-a456-426614174000')`,
      [cid],
    );
    const inbox = (
      await b.q<{ j: Array<{ unread: number; kind: string }> }>(`select my_conversations() j`)
    )[0]!.j;
    expect(inbox[0]).toMatchObject({ kind: 'direct', unread: 1 });
  });
});
