import { describe, expect, it } from 'vitest';
import type { ApiError, FeedItem } from './api';
import { feedReducer, initialFeed, type FeedEvent, type FeedState } from './feed-state';

const item = (id: string) => ({ contentId: id }) as FeedItem;
const run = (events: FeedEvent[], from: FeedState = initialFeed) =>
  events.reduce(feedReducer, from);
// plain object: importing the real ApiError would pull React Native into a Node test
const err = { status: 0, code: 'offline', isOffline: true } as unknown as ApiError;

describe('feed state', () => {
  it('first load → items; appending dedups; an empty page marks the feed exhausted', () => {
    let s = run([
      { type: 'started', kind: 'first', gen: 0 },
      { type: 'succeeded', kind: 'first', gen: 0, items: [item('a'), item('b')] },
    ]);
    expect(s.items.map((i) => i.contentId)).toEqual(['a', 'b']);
    expect(s.loading).toBe(false);
    s = run([{ type: 'started', kind: 'more', gen: 0 }], s);
    expect(s.paging).toBe(true);
    s = run([{ type: 'succeeded', kind: 'more', gen: 0, items: [item('b'), item('c')] }], s);
    expect(s.items.map((i) => i.contentId)).toEqual(['a', 'b', 'c']);
    expect(s.exhausted).toBe(false);
    s = run([{ type: 'succeeded', kind: 'more', gen: 0, items: [] }], s);
    expect(s.exhausted).toBe(true);
  });
  it('pull-to-refresh prepends new items above the list and reports "up to date" when nothing is new', () => {
    const s = run([{ type: 'succeeded', kind: 'first', gen: 0, items: [item('b')] }]);
    const r = run([{ type: 'started', kind: 'refresh', gen: 0 }], s);
    expect(r.refreshing).toBe(true);
    const done = run(
      [{ type: 'succeeded', kind: 'refresh', gen: 0, items: [item('a'), item('b')] }],
      r,
    );
    expect(done.items.map((i) => i.contentId)).toEqual(['a', 'b']);
    expect(done.upToDate).toBe(false);
    expect(run([{ type: 'succeeded', kind: 'refresh', gen: 0, items: [] }], done).upToDate).toBe(
      true,
    );
  });
  it('a failed background page keeps the feed readable (pagingError only); a failed first load is a full error', () => {
    const s = run([{ type: 'succeeded', kind: 'first', gen: 0, items: [item('a')] }]);
    const more = run(
      [
        { type: 'started', kind: 'more', gen: 0 },
        { type: 'failed', kind: 'more', gen: 0, error: err },
      ],
      s,
    );
    expect(more.items).toHaveLength(1);
    expect(more.error).toBeNull();
    expect(more.pagingError).toBe(err);
    expect(more.paging).toBe(false);
    // the learner retrying clears the paging error
    expect(run([{ type: 'started', kind: 'more', gen: 0 }], more).pagingError).toBeNull();
    const first = run([{ type: 'failed', kind: 'first', gen: 0, error: err }]);
    expect(first.error).toBe(err);
    expect(first.loading).toBe(false);
    // retry after an error clears it and shows loading again
    const retry = run([{ type: 'started', kind: 'first', gen: 0 }], first);
    expect([retry.error, retry.loading]).toEqual([null, true]);
  });
  it('a failed refresh with items on screen records the error without dropping the items', () => {
    const s = run([{ type: 'succeeded', kind: 'first', gen: 0, items: [item('a')] }]);
    const f = run(
      [
        { type: 'started', kind: 'refresh', gen: 0 },
        { type: 'failed', kind: 'refresh', gen: 0, error: err },
      ],
      s,
    );
    expect(f.items).toHaveLength(1);
    expect(f.error).toBe(err);
    expect(f.refreshing).toBe(false);
  });
  it('reset (language change) clears the list, and responses requested BEFORE the reset are ignored', () => {
    const s = run([
      { type: 'succeeded', kind: 'first', gen: 0, items: [item('old1'), item('old2')] },
    ]);
    const r = run([{ type: 'reset' }], s);
    expect(r.items).toEqual([]);
    expect(r.loading).toBe(true);
    expect(r.gen).toBe(1);
    // a late English-ranked batch from before the language change must not appear
    expect(
      run([{ type: 'succeeded', kind: 'more', gen: 0, items: [item('late')] }], r).items,
    ).toEqual([]);
    expect(run([{ type: 'failed', kind: 'first', gen: 0, error: err }], r).error).toBeNull();
    // the new generation's batch is accepted
    expect(
      run([{ type: 'succeeded', kind: 'first', gen: 1, items: [item('new')] }], r).items.map(
        (i) => i.contentId,
      ),
    ).toEqual(['new']);
  });
});
