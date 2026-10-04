import { describe, expect, it } from 'vitest';
import { ack, emptyQueue, enqueue, fail, MAX_QUEUE, nextBatch } from './event-queue-core';
import { mediaState, mergeBatch, shouldFetchMore } from './feed-window';
import { uuid } from './uuid';

describe('event queue', () => {
  it('caps by dropping the oldest', () => {
    let q = emptyQueue();
    for (let i = 0; i < MAX_QUEUE + 10; i++) q = enqueue(q, { name: 'like', at: i });
    expect(q.events).toHaveLength(MAX_QUEUE);
    expect(q.events[0]!.at).toBe(10);
  });
  it('backs off exponentially after failures and resets after an ack', () => {
    let q = enqueue(emptyQueue(), { name: 'like', at: 1 });
    q = fail(q, 1000);
    expect(nextBatch(q, 1500)).toEqual([]);
    expect(nextBatch(q, 3001)).toHaveLength(1);
    q = fail(q, 4000);
    expect(q.nextAttemptAt - 4000).toBe(4000);
    expect(ack(q, 1)).toEqual({ events: [], failures: 0, nextAttemptAt: 0 });
  });
});
describe('feed window', () => {
  it('only the active card is live; neighbours preload; the rest release', () => {
    expect([0, 1, 2, 3, 4].map((i) => mediaState(i, 2))).toEqual([
      'released',
      'preload',
      'active',
      'preload',
      'released',
    ]);
  });
  it('prefetches near the end, not while loading or exhausted', () => {
    expect(shouldFetchMore(7, 10, false, false)).toBe(true);
    expect(shouldFetchMore(2, 10, false, false)).toBe(false);
    expect(shouldFetchMore(8, 10, true, false)).toBe(false);
    expect(shouldFetchMore(8, 10, false, true)).toBe(false);
  });
  it('merges without duplicates', () => {
    expect(
      mergeBatch(
        [{ contentId: 'a' }, { contentId: 'b' }],
        [{ contentId: 'b' }, { contentId: 'c' }],
      ).map((x) => x.contentId),
    ).toEqual(['a', 'b', 'c']);
  });
});
describe('uuid', () => {
  it('is a v4 uuid and unique', () => {
    const a = uuid();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid()).not.toBe(a);
  });
});
