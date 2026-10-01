import { describe, expect, it } from 'vitest';
import {
  applyEvidence,
  classify,
  estimate,
  newMasteryState,
  evidenceWeight,
  newReviewCard,
  scheduleReview,
  gradeFromPerformance,
  isDue,
  retrievability,
  difficultyFit,
  targetDifficulty,
  updateItemDifficulty,
  updateFrustration,
  detectWeakConcepts,
  xpFor,
  levelFromXp,
  updateStreak,
  type MasteryState,
} from './index';

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

describe('mastery', () => {
  it('starts at an uncertain 0.5 prior', () => {
    const e = estimate(newMasteryState(), T0);
    expect(e.mastery).toBeCloseTo(0.5);
    expect(e.confidence).toBe(0);
  });
  it('rises with correct answers and gains confidence', () => {
    let s = newMasteryState();
    for (let i = 0; i < 6; i++) s = applyEvidence(s, { kind: 'answer', correct: true, at: T0 });
    const e = estimate(s, T0);
    expect(e.mastery).toBeGreaterThan(0.8);
    expect(e.confidence).toBeGreaterThan(0.6);
    expect(classify(s, T0)).toBe('mastered');
  });
  it('repeated mistakes weigh more than a single mistake', () => {
    const once = applyEvidence(newMasteryState(), { kind: 'answer', correct: false, at: T0 });
    const twice = applyEvidence(once, { kind: 'answer', correct: false, at: T0 });
    expect(twice.repeatedMistakes).toBe(1);
    expect(twice.beta - once.beta).toBeGreaterThan(once.beta - 1);
    expect(classify(twice, T0)).toBe('weak');
  });
  it('overconfident wrong answers count as stronger weakness evidence', () => {
    const base = applyEvidence(newMasteryState(), { kind: 'answer', correct: false, at: T0 });
    const over = applyEvidence(newMasteryState(), {
      kind: 'answer',
      correct: false,
      confidence: 0.95,
      at: T0,
    });
    expect(over.beta).toBeGreaterThan(base.beta);
  });
  it('hints reduce evidence from a correct answer; delayed recall increases it', () => {
    const plain = evidenceWeight({ kind: 'answer', correct: true, at: T0 });
    expect(evidenceWeight({ kind: 'answer', correct: true, hintsUsed: 2, at: T0 })).toBeLessThan(
      plain,
    );
    expect(evidenceWeight({ kind: 'delayed_recall', correct: true, at: T0 })).toBeGreaterThan(
      plain,
    );
  });
  it('exposure alone does not count as mastery', () => {
    const s = applyEvidence(newMasteryState(), { kind: 'exposure', at: T0 });
    expect(classify(s, T0)).toBe('exposed');
    expect(estimate(s, T0).mastery).toBeCloseTo(0.5);
  });
  it('decays toward the prior so strong old knowledge becomes stale', () => {
    let s = newMasteryState();
    for (let i = 0; i < 8; i++) s = applyEvidence(s, { kind: 'answer', correct: true, at: T0 });
    const later = T0 + 200 * DAY;
    expect(estimate(s, later).mastery).toBeLessThan(estimate(s, T0).mastery);
    expect(classify(s, later)).toBe('stale');
  });
});

describe('scheduler (FSRS)', () => {
  it('maps performance to grades', () => {
    expect(gradeFromPerformance({ correct: false })).toBe('again');
    expect(gradeFromPerformance({ correct: true, hintsUsed: 1 })).toBe('hard');
    expect(
      gradeFromPerformance({ correct: true, responseMs: 1000, expectedMs: 4000, confidence: 0.9 }),
    ).toBe('easy');
    expect(gradeFromPerformance({ correct: true })).toBe('good');
  });
  it('schedules further out after successful reviews and records version', () => {
    let c = newReviewCard(T0);
    expect(isDue(c, T0)).toBe(true);
    let now = T0;
    let last = 0;
    for (let i = 0; i < 4; i++) {
      c = scheduleReview(c, 'good', now);
      const interval = c.due - now;
      expect(interval).toBeGreaterThanOrEqual(last);
      last = interval;
      now = c.due;
    }
    expect(c.schedulerVersion).toBe('fsrs_v1');
    expect(c.reps).toBe(4);
  });
  it('a lapse is counted and brings the review sooner than a good grade', () => {
    let c = newReviewCard(T0);
    let now = T0;
    for (let i = 0; i < 3; i++) {
      c = scheduleReview(c, 'good', now);
      now = c.due;
    }
    const lapsed = scheduleReview(c, 'again', now);
    const good = scheduleReview(c, 'good', now);
    expect(lapsed.lapses).toBe(c.lapses + 1);
    expect(lapsed.due).toBeLessThan(good.due);
  });
  it('retrievability decreases over time', () => {
    let c = newReviewCard(T0);
    c = scheduleReview(c, 'good', T0);
    c = scheduleReview(c, 'good', c.due);
    const t = c.lastReview!;
    expect(retrievability(c, t + 30 * DAY)).toBeLessThan(retrievability(c, t + DAY));
  });
});

describe('difficulty', () => {
  it('targets a stretch above ability, easing under frustration', () => {
    expect(targetDifficulty(0.5, 0)).toBeGreaterThan(0.5);
    expect(targetDifficulty(0.5, 1)).toBeLessThan(targetDifficulty(0.5, 0));
  });
  it('fit peaks at the target', () => {
    expect(difficultyFit(0.6, 0.6)).toBe(1);
    expect(difficultyFit(0.9, 0.3)).toBeLessThan(difficultyFit(0.5, 0.3));
  });
  it('items become harder when strong learners miss them', () => {
    expect(updateItemDifficulty(0.5, 0.9, false, 0)).toBeGreaterThan(0.5);
    expect(updateItemDifficulty(0.5, 0.2, true, 0)).toBeLessThan(0.5);
  });
  it('frustration rises with failure/abandon and decays with success', () => {
    const f1 = updateFrustration(0, { correct: false, abandoned: true });
    expect(f1).toBeGreaterThan(0.1);
    expect(updateFrustration(f1, { correct: true })).toBeLessThan(f1);
  });
});

describe('weak concept detection', () => {
  const wrong = (n: number): MasteryState => {
    let s = newMasteryState();
    for (let i = 0; i < n; i++) s = applyEvidence(s, { kind: 'answer', correct: false, at: T0 });
    return s;
  };
  it('surfaces weak concepts and their weak prerequisites; ignores unseen', () => {
    const states = new Map<string, MasteryState>([
      ['ohm', wrong(3)],
      ['volt', wrong(2)],
    ]);
    const res = detectWeakConcepts(
      [
        { id: 'ohm', prerequisiteIds: ['volt'] },
        { id: 'volt', prerequisiteIds: [] },
        { id: 'new', prerequisiteIds: [] },
      ],
      states,
      T0,
    );
    expect(res.map((r) => r.conceptId)).toContain('ohm');
    expect(res.map((r) => r.conceptId)).not.toContain('new');
    expect(res.find((r) => r.conceptId === 'ohm')!.reason).toBe('repeated_mistakes');
  });
});

describe('gamification', () => {
  it('rewards learning, not passive watching', () => {
    expect(xpFor('watch_complete')).toBe(0);
    expect(xpFor('question_correct')).toBeGreaterThan(xpFor('question_incorrect_attempt'));
  });
  it('levels are monotonic', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(10_000).level).toBeGreaterThan(levelFromXp(1_000).level);
  });
  it('streaks continue on consecutive days, reset after a gap, are idempotent same-day', () => {
    let s = { current: 0, longest: 0, lastDay: null as number | null };
    s = updateStreak(s, 10);
    s = updateStreak(s, 10);
    expect(s.current).toBe(1);
    s = updateStreak(s, 11);
    expect(s.current).toBe(2);
    s = updateStreak(s, 14);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(2);
  });
});
