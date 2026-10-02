/**
 * Event taxonomy — single source of truth (docs/ANALYTICS.md is generated from the same intent).
 * Every event documents source, payload keys, privacy class, aggregation and model usage.
 */
export type EventSource = 'client' | 'server' | 'job';
export type PrivacyClass = 'behavioural' | 'learning' | 'account' | 'safety';
export type ModelUse = 'engagement' | 'learning' | 'quality' | 'safety' | 'ops' | 'none';

export interface EventSpec {
  source: EventSource;
  /** Allowed payload keys (everything else is dropped). */
  payload: readonly string[];
  privacy: PrivacyClass;
  aggregation: 'count' | 'sum_duration' | 'rate' | 'latest' | 'none';
  model: readonly ModelUse[];
  /** Raw retention in days before aggregation-only (docs/ANALYTICS.md §Retention). */
  retentionDays: number;
}

const b = (
  payload: string[],
  model: ModelUse[],
  aggregation: EventSpec['aggregation'] = 'count',
  privacy: PrivacyClass = 'behavioural',
  retentionDays = 90,
  source: EventSource = 'client',
): EventSpec => ({ source, payload, privacy, aggregation, model, retentionDays });

const FEED = ['content_id', 'position', 'ranking_version', 'recommendation_id'];
/** Outcome attribution (audit H9): outcome events may carry the recommendation they came from; joins are by (user, recommendation, content). */
const REC = 'recommendation_id';

export const EVENT_TAXONOMY = {
  session_started: b(['platform', 'app_version'], ['ops']),
  session_ended: b(['duration_ms'], ['engagement'], 'sum_duration'),
  feed_impression: b(FEED, ['engagement']),
  content_visible: b([...FEED, 'visible_ms'], ['engagement'], 'sum_duration'),
  watch_start: b(FEED, ['engagement']),
  watch_progress: b([...FEED, 'progress', 'watched_ms'], ['engagement'], 'sum_duration'),
  watch_complete: b([...FEED, 'watched_ms'], ['engagement']),
  skip: b([...FEED, 'watched_ms', 'immediate'], ['engagement', 'quality']),
  replay: b(FEED, ['engagement']),
  like: b(['content_id', REC], ['engagement']),
  unlike: b(['content_id', REC], ['engagement']),
  save: b(['content_id', REC], ['engagement']),
  unsave: b(['content_id', REC], ['engagement']),
  share: b(['content_id', 'channel', REC], ['engagement']),
  follow: b(['creator_id'], ['engagement']),
  unfollow: b(['creator_id'], ['engagement']),
  comment: b(['content_id', 'comment_id', REC], ['engagement']), // never the comment text
  content_open: b(['content_id', 'from', REC], ['engagement']),
  note_open: b(['content_id', 'concept_id', REC], ['engagement', 'learning']),
  quiz_open: b(['content_id', 'quiz_id', REC], ['engagement', 'learning']),
  question_answered: b(
    ['question_id', 'attempt_id', 'response_ms', 'hints_used', 'attempt_no', REC],
    ['learning'],
    'count',
    'learning',
  ),
  answer_correct: b(
    ['question_id', 'concept_id', 'response_ms', REC],
    ['learning', 'quality'],
    'count',
    'learning',
  ),
  answer_incorrect: b(
    ['question_id', 'concept_id', 'response_ms', REC],
    ['learning', 'quality'],
    'count',
    'learning',
  ),
  hint_used: b(['question_id', 'hint_no', REC], ['learning'], 'count', 'learning'),
  confidence_submitted: b(['question_id', 'confidence', REC], ['learning'], 'count', 'learning'),
  flashcard_reviewed: b(['flashcard_id', 'grade'], ['learning'], 'count', 'learning', 365),
  review_completed: b(['concept_id', 'count'], ['learning'], 'count', 'learning', 365),
  concept_mastered: b(['concept_id', 'mastery'], ['learning'], 'latest', 'learning', 365),
  concept_reviewed: b(['concept_id'], ['learning'], 'count', 'learning', 365),
  interaction_completed: b(
    ['content_id', 'kind', 'score', 'duration_ms', REC],
    ['learning', 'engagement'],
    'count',
    'learning',
  ),
  content_reported: b(['content_id', 'reason', REC], ['safety', 'quality'], 'count', 'safety', 730),
  creator_profile_opened: b(['creator_id'], ['engagement']),
  next_card_requested: b(['batch_size', 'ranking_version'], ['ops']),
} as const satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENT_TAXONOMY;
export const EVENT_NAMES = Object.keys(EVENT_TAXONOMY) as EventName[];

/** Keys that must never appear in any analytics payload (docs/SECURITY.md §Analytics privacy). */
const FORBIDDEN =
  /(pass(word)?|secret|token|authorization|api[_-]?key|jwt|cookie|email|phone|message_body|body|text)/i;

export interface RawEvent {
  name: string;
  payload?: Record<string, unknown>;
  at?: number;
}
export interface CleanEvent {
  name: EventName;
  payload: Record<string, string | number | boolean | null>;
  at: number;
}

/** Validate + minimise: unknown events rejected, unknown/forbidden payload keys dropped, values primitive only. */
export function sanitizeEvent(raw: RawEvent, now: number): CleanEvent | null {
  const spec = (EVENT_TAXONOMY as Record<string, EventSpec>)[raw.name];
  if (!spec) return null;
  const payload: CleanEvent['payload'] = {};
  for (const k of spec.payload) {
    if (FORBIDDEN.test(k)) continue;
    const v = raw.payload?.[k];
    if (v === undefined) continue;
    if (v === null || typeof v === 'number' || typeof v === 'boolean') payload[k] = v as never;
    else if (typeof v === 'string') payload[k] = v.slice(0, 128);
  }
  const at =
    typeof raw.at === 'number' && raw.at <= now + 60_000 && raw.at > now - 7 * 86_400_000
      ? raw.at
      : now;
  return { name: raw.name as EventName, payload, at };
}

/** Which events produce which learner-feature feedback (engagement vs learning response). */
export const FEEDBACK_MAP: Partial<
  Record<EventName, { type: 'engagement' | 'learning'; name: string }>
> = {
  watch_complete: { type: 'engagement', name: 'watch_complete' },
  replay: { type: 'engagement', name: 'replay' },
  like: { type: 'engagement', name: 'like' },
  unlike: { type: 'engagement', name: 'unlike' },
  save: { type: 'engagement', name: 'save' },
  unsave: { type: 'engagement', name: 'unsave' },
  share: { type: 'engagement', name: 'share' },
  follow: { type: 'engagement', name: 'follow' },
  comment: { type: 'engagement', name: 'comment' },
  content_open: { type: 'engagement', name: 'content_open' },
  quiz_open: { type: 'engagement', name: 'question_opened' },
  content_reported: { type: 'engagement', name: 'content_reported' },
  answer_correct: { type: 'learning', name: 'answer_correct' },
  answer_incorrect: { type: 'learning', name: 'answer_incorrect' },
  concept_mastered: { type: 'learning', name: 'concept_mastered' },
};

/** Skips map to skip vs skip_immediate depending on watched time. */
export function skipSignal(payload: {
  watched_ms?: number;
  immediate?: boolean;
}): 'skip' | 'skip_immediate' {
  return payload.immediate || (payload.watched_ms ?? Infinity) < 1500 ? 'skip_immediate' : 'skip';
}
