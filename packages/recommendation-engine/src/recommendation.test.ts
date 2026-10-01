import { describe, expect, it } from 'vitest';
import { RANKING_V1 } from '@learning-loop/config';
import { targetDifficulty } from '@learning-loop/learning-engine';
import {
  applyFeedback, newLearnerFeatures, rankFeed, scoreCandidate, filterEligible, recordImpression,
  examPressure, updateAffinity, effective, mulberry32, thompsonPick, sampleBeta, targetDifficultyFor,
  type Candidate, type LearnerFeatures,
} from './index';

const NOW = Date.UTC(2026, 5, 1);
const cand = (id: string, o: Partial<Candidate> = {}): Candidate => ({
  contentId: id, conceptIds: [`c-${id}`], subjectId: 'math', creatorId: `cr-${id}`, format: 'video',
  hook: 'curiosity', difficulty: 0.5, quality: 0.7, socialSignal: 0.3, learningGainStat: null,
  ageHours: 24, sources: ['interest'], published: true, moderationOk: true, freshness: 'current', ...o,
});
const learner = (o: Partial<LearnerFeatures> = {}): LearnerFeatures => ({ ...newLearnerFeatures('u1'), ...o });

describe('target difficulty parity with learning-engine', () => {
  it('matches for a grid of inputs', () => {
    for (const a of [0, 0.3, 0.7, 1]) for (const fr of [0, 0.5, 1])
      expect(targetDifficultyFor({ ability: a, frustration: fr })).toBeCloseTo(targetDifficulty(a, fr));
  });
});

describe('affinity learning', () => {
  it('saves raise preference more than completes; skips lower it', () => {
    const save = updateAffinity(undefined, 1).score;
    const complete = updateAffinity(undefined, 0.6).score;
    const skip = updateAffinity(undefined, -0.7).score;
    expect(save).toBeGreaterThan(complete);
    expect(skip).toBeLessThan(0.5);
  });
  it('one tap cannot lock in a preference (shrinkage)', () => {
    expect(effective(updateAffinity(undefined, 1))).toBeLessThan(0.65);
  });
  it('behaviour changes the feature vector', () => {
    let f = learner();
    for (let i = 0; i < 6; i++) f = applyFeedback(f, { type: 'engagement', name: 'save', subjectId: 'geo', format: 'map', hook: 'challenge', creatorId: 'x' });
    expect(effective(f.format['map'])).toBeGreaterThan(0.7);
    expect(effective(f.hook['challenge'])).toBeGreaterThan(0.7);
  });
  it('learning response is tracked separately from engagement', () => {
    let f = learner();
    f = applyFeedback(f, { type: 'engagement', name: 'watch_complete', format: 'animation' });
    f = applyFeedback(f, { type: 'learning', name: 'answer_incorrect', format: 'animation' });
    expect(f.format['animation']!.score).toBeGreaterThan(0.5);
    expect(f.formatLearning['animation']!.score).toBeLessThan(0.5);
  });
});

describe('scoring', () => {
  it('weak-concept content outscores otherwise identical content', () => {
    const f = learner({ conceptNeed: { 'c-a': 0.9 } });
    const a = scoreCandidate(cand('a'), f, RANKING_V1, NOW);
    const b = scoreCandidate(cand('b'), f, RANKING_V1, NOW);
    expect(a.score).toBeGreaterThan(b.score);
  });
  it('contributions + penalties sum to the score (explainability invariant)', () => {
    const f = recordImpression(learner({ conceptNeed: { 'c-a': 0.5 } }), { contentId: 'z', conceptIds: ['c-a'], creatorId: 'cr-a', hook: 'curiosity', format: 'video' });
    const s = scoreCandidate(cand('a'), f, RANKING_V1, NOW);
    const total = [...s.contributions, ...s.penalties].reduce((x, y) => x + y.contribution, 0);
    expect(total).toBeCloseTo(s.score, 10);
    expect(s.penalties.length).toBeGreaterThan(0);
  });
  it('difficulty fit prefers a stretch above ability', () => {
    const f = learner({ ability: 0.5 });
    expect(scoreCandidate(cand('a', { difficulty: 0.62 }), f, RANKING_V1, NOW).score)
      .toBeGreaterThan(scoreCandidate(cand('b', { difficulty: 0.95 }), f, RANKING_V1, NOW).score);
  });
  it('deliberate review is exempt from repetition penalty', () => {
    const f = recordImpression(learner({ dueConceptIds: ['c-a'] }), { contentId: 'a', conceptIds: ['c-a'], creatorId: 'cr-a', hook: 'curiosity', format: 'video' });
    expect(scoreCandidate(cand('a', { sources: ['review_due'] }), f, RANKING_V1, NOW).penalties).toEqual([]);
  });
  it('exam pressure shifts weight toward learning need but never zeroes interests', () => {
    const base = learner({ conceptNeed: { 'c-a': 0.9 }, subject: { math: { score: 0.9, n: 20 } } });
    const near = { ...base, examDate: NOW + 5 * 86_400_000 };
    expect(examPressure(near.examDate, NOW)).toBe(1);
    const far = scoreCandidate(cand('a'), base, RANKING_V1, NOW);
    const close = scoreCandidate(cand('a'), near, RANKING_V1, NOW);
    const w = (s: typeof far, k: string) => s.contributions.find((c) => c.feature === k)!.contribution;
    expect(w(close, 'learning_need')).toBeGreaterThan(w(far, 'learning_need'));
    expect(w(close, 'personal_interest')).toBeGreaterThan(0);
  });
});

describe('eligibility', () => {
  it('excludes unpublished, moderated, outdated, blocked, seen and duplicate candidates with reasons', () => {
    const f = learner({ blockedCreatorIds: ['cr-d'], seenContentIds: ['e'] });
    const { eligible, excluded } = filterEligible(
      [cand('a'), cand('b', { published: false }), cand('c', { moderationOk: false }), cand('d'), cand('e'),
       cand('f', { freshness: 'outdated' }), cand('a')], f);
    expect(eligible.map((c) => c.contentId)).toEqual(['a']);
    expect(excluded.map((x) => x.reason).sort()).toEqual(
      ['already_seen', 'blocked_creator', 'duplicate_in_pool', 'moderation', 'not_published', 'outdated']);
  });
  it('allows a seen item back when it is a due review', () => {
    const f = learner({ seenContentIds: ['a'] });
    expect(filterEligible([cand('a', { sources: ['review_due'] })], f).eligible).toHaveLength(1);
  });
});

describe('rankFeed', () => {
  const pool = Array.from({ length: 40 }, (_, i) => cand(`p${i}`, {
    creatorId: `cr${i % 4}`, subjectId: ['math', 'geo', 'eng'][i % 3]!, format: (['video', 'map', 'question', 'note'] as const)[i % 4]!,
    sources: i % 7 === 0 ? ['exploration'] : ['interest'], quality: 0.5 + (i % 5) / 10,
  }));
  it('is deterministic for a seed and returns a bounded batch', () => {
    const a = rankFeed(pool, learner(), RANKING_V1, { now: NOW, seed: 7 });
    const b = rankFeed(pool, learner(), RANKING_V1, { now: NOW, seed: 7 });
    expect(a).toEqual(b);
    expect(a.items).toHaveLength(RANKING_V1.batchSize);
    expect(a.rankingVersion).toBe('ranking_v1');
  });
  it('enforces diversity and reserves exploration slots', () => {
    const r = rankFeed(pool, learner(), RANKING_V1, { now: NOW, seed: 3 });
    const byCreator = new Map<string, number>();
    for (const it of r.items) {
      const c = pool.find((p) => p.contentId === it.contentId)!;
      byCreator.set(c.creatorId, (byCreator.get(c.creatorId) ?? 0) + 1);
    }
    expect(Math.max(...byCreator.values())).toBeLessThanOrEqual(RANKING_V1.diversity.maxPerCreator * 2);
    expect(r.diagnostics.explorationCount).toBeGreaterThanOrEqual(1);
    expect(r.items.every((i) => Object.keys(i.whyShown).length > 0)).toBe(true);
  });
  it('never returns duplicates and handles low inventory gracefully', () => {
    const r = rankFeed(pool.slice(0, 3), learner(), RANKING_V1, { now: NOW });
    expect(r.items).toHaveLength(3);
    expect(new Set(r.items.map((i) => i.contentId)).size).toBe(3);
    expect(rankFeed([], learner(), RANKING_V1, { now: NOW }).items).toEqual([]);
  });
  it('learning from behaviour changes the next feed (closed loop)', () => {
    let f = learner();
    const before = rankFeed(pool, f, RANKING_V1, { now: NOW, seed: 1 }).items.slice(0, 5).map((i) => i.contentId);
    for (let i = 0; i < 8; i++) f = applyFeedback(f, { type: 'engagement', name: 'save', subjectId: 'geo', format: 'map', hook: 'curiosity', creatorId: 'cr1' });
    const after = rankFeed(pool, f, RANKING_V1, { now: NOW, seed: 1 }).items.slice(0, 5).map((i) => i.contentId);
    expect(after).not.toEqual(before);
    const geoShare = (ids: string[]) => ids.filter((id) => pool.find((p) => p.contentId === id)!.subjectId === 'geo').length;
    expect(geoShare(after)).toBeGreaterThanOrEqual(geoShare(before));
  });
});

describe('bandit helpers', () => {
  it('Thompson sampling favours arms with strong positive evidence', () => {
    const arms = { a: { score: 0.9, n: 50 }, b: { score: 0.2, n: 50 } };
    const rng = mulberry32(42);
    let a = 0;
    for (let i = 0; i < 200; i++) if (thompsonPick(arms, ['a', 'b'], rng) === 'a') a++;
    expect(a).toBeGreaterThan(190);
  });
  it('samples lie in (0,1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) { const x = sampleBeta(2, 3, rng); expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1); }
  });
});
