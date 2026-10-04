import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';

/**
 * Spaced repetition: FSRS via `ts-fsrs` (MIT, maintained). We wrap it so (a) persisted rows
 * carry a scheduler version, (b) the rest of the app never imports ts-fsrs directly, and
 * (c) our performance→rating mapping is explicit and testable. We make no claim of
 * superiority beyond what FSRS's authors publish.
 */
export const SCHEDULER_VERSION = 'fsrs_v1';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewCardState {
  due: number; // epoch ms
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReview: number | null;
  schedulerVersion: string;
}

const STATE_NAMES = ['new', 'learning', 'review', 'relearning'] as const;
const STATE_BY_NAME: Record<ReviewCardState['state'], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};
const GRADE_TO_RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

const engine = fsrs(generatorParameters({ enable_fuzz: false }));

const toState = (c: Card): ReviewCardState => ({
  due: c.due.getTime(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsedDays: c.elapsed_days,
  scheduledDays: c.scheduled_days,
  reps: c.reps,
  lapses: c.lapses,
  learningSteps: c.learning_steps,
  state: STATE_NAMES[c.state] ?? 'new',
  lastReview: c.last_review ? c.last_review.getTime() : null,
  schedulerVersion: SCHEDULER_VERSION,
});

const toCard = (s: ReviewCardState): Card => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  elapsed_days: s.elapsedDays,
  scheduled_days: s.scheduledDays,
  reps: s.reps,
  lapses: s.lapses,
  learning_steps: s.learningSteps,
  state: STATE_BY_NAME[s.state],
  last_review: s.lastReview == null ? undefined : new Date(s.lastReview),
});

export const newReviewCard = (now: number): ReviewCardState =>
  toState(createEmptyCard(new Date(now)));

export function scheduleReview(card: ReviewCardState, grade: Grade, now: number): ReviewCardState {
  const result = engine.next(toCard(card), new Date(now), GRADE_TO_RATING[grade]);
  return toState(result.card);
}

export interface Performance {
  correct: boolean;
  /** ms taken to answer */
  responseMs?: number;
  /** typical ms for this item; used to detect fluent answers */
  expectedMs?: number;
  hintsUsed?: number;
  attempts?: number;
  /** self-reported 0..1 */
  confidence?: number;
}

/** Map demonstrated performance (not time elapsed) to an FSRS grade. */
export function gradeFromPerformance(p: Performance): Grade {
  if (!p.correct) return 'again';
  const slow = p.expectedMs && p.responseMs ? p.responseMs > 2 * p.expectedMs : false;
  const fast = p.expectedMs && p.responseMs ? p.responseMs < 0.6 * p.expectedMs : false;
  if ((p.hintsUsed ?? 0) > 0 || (p.attempts ?? 1) > 1 || slow) return 'hard';
  if (fast && (p.confidence ?? 0.5) >= 0.7) return 'easy';
  return 'good';
}

export const isDue = (c: ReviewCardState, now: number) => c.due <= now;

/** Probability of recall right now, per FSRS forgetting curve. */
export function retrievability(c: ReviewCardState, now: number): number {
  if (c.state === 'new' || c.lastReview == null) return 0;
  return engine.get_retrievability(toCard(c), new Date(now), false) as number;
}
