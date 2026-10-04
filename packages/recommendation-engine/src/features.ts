import type { Affinity, LearnerFeatures } from './types.ts';

export const FEATURES_VERSION = 'features_v1';

export const newLearnerFeatures = (learnerId: string): LearnerFeatures => ({
  learnerId,
  subject: {},
  format: {},
  hook: {},
  creator: {},
  formatLearning: {},
  hookLearning: {},
  ability: 0.5,
  frustration: 0,
  conceptNeed: {},
  dueConceptIds: [],
  followedCreatorIds: [],
  seenContentIds: [],
  blockedCreatorIds: [],
  examRelevance: {},
  examDate: null,
  recent: { contentIds: [], conceptIds: [], creatorIds: [], hooks: [], formats: [] },
  sessionFatigue: 0,
});

/**
 * Configurable behavioural weights (engagement signal in [-1, 1]).
 * Starting concepts from docs/GAMIFICATION + FEED_RANKING, not permanent truths:
 * tune via config versions and experiments.
 */
export const ENGAGEMENT_SIGNALS: Record<string, number> = {
  watch_complete: 0.6,
  replay: 0.8,
  like: 0.7,
  unlike: -0.4,
  save: 1.0,
  unsave: -0.5,
  share: 0.8,
  follow: 0.9,
  comment: 0.7,
  content_open: 0.5,
  question_opened: 0.6,
  skip_immediate: -0.7,
  skip: -0.3,
  content_reported: -1.0,
};

/** Learning-response signals (Model B) in [-1, 1]. */
export const LEARNING_SIGNALS: Record<string, number> = {
  answer_correct: 0.6,
  answer_incorrect: -0.5,
  repeated_mistake: -0.9,
  delayed_recall_success: 1.0,
  delayed_recall_failure: -0.6,
  misconception_resolved: 0.9,
  concept_mastered: 1.0,
};

export const neutral = (): Affinity => ({ score: 0.5, n: 0 });

/** Running mean early, EMA later: fast cold-start, stable afterwards. */
export function updateAffinity(prev: Affinity | undefined, signal: number): Affinity {
  const a = prev ?? neutral();
  const target = (Math.max(-1, Math.min(1, signal)) + 1) / 2;
  const rate = Math.max(0.05, 1 / (a.n + 2));
  return { score: a.score + rate * (target - a.score), n: a.n + 1 };
}

/** Shrink toward neutral when evidence is thin so one tap can't lock a preference. */
export function effective(a: Affinity | undefined, priorStrength = 3): number {
  const x = a ?? neutral();
  return (x.score * x.n + 0.5 * priorStrength) / (x.n + priorStrength);
}

/** Uncertainty (0..1): high when we know little → exploration value. */
export const uncertainty = (a: Affinity | undefined): number => 1 / Math.sqrt(1 + (a?.n ?? 0));

export type FeedbackEvent =
  | {
      type: 'engagement';
      name: keyof typeof ENGAGEMENT_SIGNALS;
      subjectId?: string;
      format?: string;
      hook?: string | null;
      creatorId?: string;
    }
  | {
      type: 'learning';
      name: keyof typeof LEARNING_SIGNALS;
      format?: string;
      hook?: string | null;
    };

const bump = (rec: Record<string, Affinity>, key: string | null | undefined, signal: number) => {
  if (!key) return rec;
  return { ...rec, [key]: updateAffinity(rec[key], signal) };
};

/** Pure update: behaviour → learner features (the self-improvement step). */
export function applyFeedback(f: LearnerFeatures, ev: FeedbackEvent): LearnerFeatures {
  if (ev.type === 'engagement') {
    const s = ENGAGEMENT_SIGNALS[ev.name as string];
    if (s === undefined) return f;
    return {
      ...f,
      subject: bump(f.subject, ev.subjectId, s),
      format: bump(f.format, ev.format, s),
      hook: bump(f.hook, ev.hook, s),
      creator: bump(f.creator, ev.creatorId, s),
    };
  }
  const s = LEARNING_SIGNALS[ev.name as string];
  if (s === undefined) return f;
  return {
    ...f,
    formatLearning: bump(f.formatLearning, ev.format, s),
    hookLearning: bump(f.hookLearning, ev.hook, s),
  };
}

const push = (arr: string[], v: string, max = 30) => [...arr, v].slice(-max);

/** Record that a card was shown (feeds repetition penalties + dedupe). */
export function recordImpression(
  f: LearnerFeatures,
  c: {
    contentId: string;
    conceptIds: string[];
    creatorId: string;
    hook: string | null;
    format: string;
  },
): LearnerFeatures {
  return {
    ...f,
    seenContentIds: f.seenContentIds.includes(c.contentId)
      ? f.seenContentIds
      : [...f.seenContentIds, c.contentId],
    recent: {
      contentIds: push(f.recent.contentIds, c.contentId),
      conceptIds: c.conceptIds.reduce((a, id) => push(a, id), f.recent.conceptIds),
      creatorIds: push(f.recent.creatorIds, c.creatorId),
      hooks: c.hook ? push(f.recent.hooks, c.hook) : f.recent.hooks,
      formats: push(f.recent.formats, c.format),
    },
  };
}

/** Exam pressure 0..1 from days remaining (0 = none/far, 1 = imminent). */
export function examPressure(examDate: number | null, now: number): number {
  if (examDate == null) return 0;
  const days = (examDate - now) / 86_400_000;
  if (days <= 0) return 0; // exam passed
  if (days <= 7) return 1;
  if (days <= 30) return 0.75;
  if (days <= 90) return 0.4;
  if (days <= 180) return 0.15;
  return 0;
}

const top = (rec: Record<string, Affinity>, n = 5) =>
  Object.fromEntries(
    Object.entries(rec)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, n)
      .map(([k, a]) => [k, { score: Math.round(effective(a) * 1000) / 1000, n: a.n }]),
  );

/**
 * Compact, bounded "feature vector" logged with every recommendation (docs/RECOMMENDATION_ENGINE.md): enough to reconstruct the
 * learner state a ranking decision was made under, without copying the whole feature document (privacy + size).
 */
export function snapshotFeatures(f: LearnerFeatures, now: number) {
  return {
    features_version: FEATURES_VERSION,
    ability: Math.round(f.ability * 1000) / 1000,
    frustration: Math.round(f.frustration * 1000) / 1000,
    session_fatigue: Math.round(f.sessionFatigue * 1000) / 1000,
    exam_pressure: examPressure(f.examDate, now),
    due_concepts: f.dueConceptIds.length,
    weak_concepts: Object.keys(f.conceptNeed).length,
    seen_count: f.seenContentIds.length,
    followed_creators: f.followedCreatorIds.length,
    subject: top(f.subject),
    format: top(f.format),
    hook: top(f.hook),
    format_learning: top(f.formatLearning),
    hook_learning: top(f.hookLearning),
  };
}
