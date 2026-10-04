import { describe, expect, it } from 'vitest';
import {
  activate,
  beginSubmit,
  failed,
  initFlow,
  place,
  resetOrder,
  select,
  setText,
  succeeded,
  takeHint,
} from './question-flow';

let n = 0;
const newKey = () => `key-${++n}`;
const go = (f: ReturnType<typeof initFlow>, type = 'single_choice', now = 10_000, ready = true) =>
  beginSubmit(f, { type, ready, now, newKey });

describe('submit protection', () => {
  it('a second tap while a submit is in flight does nothing (double-tap safe)', () => {
    const f = select(initFlow('k0'), 'a', false);
    const first = go(f)!;
    expect(first.state.phase).toBe('submitting');
    expect(go(first.state)).toBeNull();
  });
  it('nothing can be edited or re-submitted once graded, and a restored (cached) result is already graded', () => {
    const graded = succeeded(go(select(initFlow('k0'), 'a', false))!.state);
    expect(select(graded, 'b', false)).toBe(graded);
    expect(setText(graded, 'x')).toBe(graded);
    expect(takeHint(graded)).toBe(graded);
    expect(go(graded)).toBeNull();
    const restored = initFlow('k0', { selected: ['b'], text: '' });
    expect(restored.phase).toBe('graded');
    expect(go(restored)).toBeNull();
  });
  it('refuses to submit before an answer is ready', () => {
    expect(go(initFlow('k0'), 'single_choice', 1, false)).toBeNull();
  });
  it('answer controls are locked while submitting', () => {
    const sub = go(select(initFlow('k0'), 'a', false))!.state;
    expect(select(sub, 'b', false)).toBe(sub);
    expect(place(sub, 'x')).toBe(sub);
  });
});

describe('retry handling', () => {
  it('after a failure the learner can retry with the SAME key and answer (server replays, never double-counts)', () => {
    const first = go(select(initFlow('k0'), 'a', false))!;
    const back = failed(first.state, true);
    expect(back.phase).toBe('answering');
    expect(back.error).toBe('offline');
    const retry = go(back)!;
    expect(retry.request.idempotencyKey).toBe('k0');
    expect(retry.request.response).toEqual({ optionId: 'a' });
    expect(retry.state.error).toBeNull();
  });
  it('if the learner CHANGES their answer after a failure, a NEW key is used (server would otherwise replay the first answer)', () => {
    const first = go(select(initFlow('k0'), 'a', false))!;
    const changed = select(failed(first.state, false), 'b', false);
    const retry = go(changed)!;
    expect(retry.request.idempotencyKey).not.toBe('k0');
    expect(retry.request.response).toEqual({ optionId: 'b' });
    // and a further retry of that same new answer keeps the new key
    const again = go(failed(retry.state, true))!;
    expect(again.request.idempotencyKey).toBe(retry.request.idempotencyKey);
  });
  it('generic vs offline failures are distinguished for the message', () => {
    const f = go(select(initFlow('k0'), 'a', false))!.state;
    expect(failed(f, true).error).toBe('offline');
    expect(failed(f, false).error).toBe('generic');
  });
});

describe('response time and hints', () => {
  it('measures from when the card became visible, not from when it mounted (preloading)', () => {
    const f = select(activate(initFlow('k0'), 50_000), 'a', false); // mounted earlier, active at 50s
    expect(go(f, 'single_choice', 57_000)!.request.responseMs).toBe(7_000);
  });
  it('the first activation wins (scrolling away and back does not reset the clock)', () => {
    const f = activate(activate(initFlow('k0'), 1_000), 9_000);
    expect(f.activeAt).toBe(1_000);
  });
  it('sends no response time at all if the card was never visible (rather than a made-up one)', () => {
    expect(go(select(initFlow('k0'), 'a', false))!.request.responseMs).toBeUndefined();
  });
  it('counts hints and sends them with the answer', () => {
    const f = select(takeHint(takeHint(initFlow('k0'))), 'a', false);
    expect(go(f)!.request.hintsUsed).toBe(2);
  });
});

describe('answer shapes through the flow', () => {
  it('multi-choice toggles; single replaces; ordering places once and can reset; text/number build the server payloads', () => {
    let m = select(select(initFlow('k'), 'a', true), 'b', true);
    m = select(m, 'a', true);
    expect(go(m, 'multi_choice')!.request.response).toEqual({ optionIds: ['b'] });
    expect(go(select(select(initFlow('k'), 'a', false), 'c', false))!.request.response).toEqual({
      optionId: 'c',
    });
    const o = place(place(place(initFlow('k'), 'x'), 'y'), 'x');
    expect(go(o, 'ordering')!.request.response).toEqual({ order: ['x', 'y'] });
    expect(resetOrder(o).selected).toEqual([]);
    expect(go(setText(initFlow('k'), '10'), 'numerical')!.request.response).toEqual({ value: 10 });
    expect(go(setText(initFlow('k'), 'Jaipur'), 'fill_blank')!.request.response).toEqual({
      value: 'Jaipur',
    });
  });
});
