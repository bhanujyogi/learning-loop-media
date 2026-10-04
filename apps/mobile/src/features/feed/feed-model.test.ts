import { beforeEach, describe, expect, it } from 'vitest';
import { answerCache } from '../../lib/answer-cache';
import { prependBatch } from '../../lib/feed-window';
import { mergeFetched, settleWrite } from '../../lib/reactions';
import { EMPTY_STATS, MAX_DOTS, recordResult } from '../../lib/session-stats';
import {
  buildResponse,
  describeCorrectAnswer,
  isReady,
  isSupportedQuestion,
  optionStates,
  verdictOf,
} from './question-model';

const opts = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id.toUpperCase() }));

describe('question responses match what the server grades', () => {
  it('builds each response shape', () => {
    expect(buildResponse('single_choice', ['b'], '')).toEqual({ optionId: 'b' });
    expect(buildResponse('multi_choice', ['a', 'c'], '')).toEqual({ optionIds: ['a', 'c'] });
    expect(buildResponse('true_false', ['true'], '')).toEqual({ value: true });
    expect(buildResponse('true_false', ['false'], '')).toEqual({ value: false });
    expect(buildResponse('numerical', [], '10')).toEqual({ value: 10 });
    expect(buildResponse('fill_blank', [], 'Jaipur')).toEqual({ value: 'Jaipur' });
    expect(buildResponse('ordering', ['b', 'a'], '')).toEqual({ order: ['b', 'a'] });
  });
  it('knows when an answer may be submitted', () => {
    const q = { type: 'numerical', prompt: 'x' };
    expect(isReady(q, [], '')).toBe(false);
    expect(isReady(q, [], 'abc')).toBe(false);
    expect(isReady(q, [], '12.5')).toBe(true);
    expect(isReady({ type: 'fill_blank', prompt: 'x' }, [], '   ')).toBe(false);
    expect(isReady({ type: 'single_choice', prompt: 'x', options: opts }, [], '')).toBe(false);
    expect(isReady({ type: 'single_choice', prompt: 'x', options: opts }, ['a'], '')).toBe(true);
    const ord = { type: 'ordering', prompt: 'x', items: opts };
    expect(isReady(ord, ['a', 'b'], '')).toBe(false);
    expect(isReady(ord, ['a', 'b', 'c', 'd'], '')).toBe(true);
  });
  it('flags unsupported question types instead of rendering them wrongly', () => {
    expect(isSupportedQuestion('single_choice')).toBe(true);
    expect(isSupportedQuestion('matching')).toBe(false);
    expect(isSupportedQuestion('map_based')).toBe(false);
  });
  it('verdict distinguishes correct / partial / incorrect', () => {
    expect(verdictOf({ correct: true, score: 1 })).toBe('correct');
    expect(verdictOf({ correct: false, score: 0.5 })).toBe('partial');
    expect(verdictOf({ correct: false, score: 0 })).toBe('incorrect');
  });
});

describe('post-grading option states', () => {
  it('single choice: wrong pick is wrong, the right one is missed; picking right is correct', () => {
    expect(optionStates('single_choice', opts, ['b'], { optionId: 'a' })).toEqual({
      a: 'missed',
      b: 'wrong',
      c: 'idle',
      d: 'idle',
    });
    expect(optionStates('single_choice', opts, ['a'], { optionId: 'a' }).a).toBe('correct');
  });
  it('multi choice mixes correct / missed / wrong', () => {
    expect(optionStates('multi_choice', opts, ['a', 'c'], { optionIds: ['a', 'b'] })).toEqual({
      a: 'correct',
      b: 'missed',
      c: 'wrong',
      d: 'idle',
    });
  });
  it('true/false maps the boolean key onto the true/false options', () => {
    const tf = [
      { id: 'true', text: 'T' },
      { id: 'false', text: 'F' },
    ];
    expect(optionStates('true_false', tf, ['true'], { value: false })).toEqual({
      true: 'wrong',
      false: 'missed',
    });
  });
  it('tolerates a missing/odd answer key without crashing', () => {
    expect(optionStates('single_choice', opts, ['a'], null).a).toBe('wrong');
  });
  it('describes the right answer for text, number and order questions', () => {
    expect(
      describeCorrectAnswer({ type: 'fill_blank', prompt: '' }, { accepted: ['Jaipur', 'jaipur'] }),
    ).toBe('Jaipur');
    expect(
      describeCorrectAnswer({ type: 'numerical', prompt: '' }, { value: 10, tolerance: 0 }),
    ).toBe('10');
    expect(
      describeCorrectAnswer({ type: 'ordering', prompt: '', items: opts }, { order: ['c', 'a'] }),
    ).toBe('1. C\n2. A');
    expect(
      describeCorrectAnswer({ type: 'single_choice', prompt: '' }, { optionId: 'a' }),
    ).toBeNull();
  });
});

describe('session stats', () => {
  it('counts only what was recorded, never negative XP, and caps the dots', () => {
    let s = recordResult(EMPTY_STATS, { correct: true, xpAwarded: 5 });
    s = recordResult(s, { correct: false, xpAwarded: -3 });
    expect(s).toMatchObject({ answered: 2, correct: 1, xp: 5, results: [true, false] });
    for (let i = 0; i < 30; i++) s = recordResult(s, { correct: true, xpAwarded: 0 });
    expect(s.results).toHaveLength(MAX_DOTS);
    expect(s.answered).toBe(32);
  });
});

describe('feed list helpers', () => {
  it('prepends only new items above the existing list', () => {
    expect(
      prependBatch(
        [{ contentId: 'b' }, { contentId: 'c' }],
        [{ contentId: 'a' }, { contentId: 'b' }],
      ).map((x) => x.contentId),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('answer cache', () => {
  beforeEach(() => answerCache.clear());
  it('remembers graded answers and evicts the oldest past the cap', () => {
    const r = { correct: true } as never;
    for (let i = 0; i < 105; i++)
      answerCache.set(`q${i}`, { selected: ['a'], text: '', result: r });
    expect(answerCache.get('q0')).toBeUndefined();
    expect(answerCache.get('q104')?.selected).toEqual(['a']);
  });
});

describe('like / save / follow write handling', () => {
  it('a duplicate insert (unique violation) means "already on": kept on, no error, no second event', () => {
    expect(settleWrite('add', { code: '23505' })).toBe('already');
    expect(settleWrite('add', null)).toBe('ok');
    expect(settleWrite('remove', null)).toBe('ok');
  });
  it('any other failure is a real failure that must roll back (RLS denial, network, server error)', () => {
    expect(settleWrite('add', { code: '42501' })).toBe('failed');
    expect(settleWrite('add', {})).toBe('failed');
    expect(settleWrite('remove', { code: '23505' })).toBe('failed'); // a unique violation on delete is not "fine"
    expect(settleWrite('remove', { code: 'PGRST301' })).toBe('failed');
  });
  it('a server lookup sets state for what it was asked about but never clobbers a row being toggled right now', () => {
    const cur = new Set(['a', 'b', 'c']);
    // asked about a,b,d; server says only d is on; the learner is mid-toggle on b
    const next = mergeFetched(cur, ['d'], new Set(['b']), ['a', 'b', 'd']);
    expect([...next].sort()).toEqual(['b', 'c', 'd']); // a cleared by the server, b protected, c untouched (not asked), d added
  });
});
