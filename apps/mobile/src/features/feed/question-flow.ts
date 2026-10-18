import type { InstantVerdict } from '../../lib/instant-check';
import { buildResponse } from './question-model';

/**
 * The question card's behaviour as a pure state machine (no React, no I/O), so the rules that protect learning data are
 * unit-tested: no double submits, retries never double-count, a changed answer gets a new idempotency key, and response time
 * is measured from when the learner could actually SEE the card (cards mount early to preload).
 */
export type Phase = 'answering' | 'submitting' | 'graded';
export interface Flow {
  phase: Phase;
  selected: string[];
  text: string;
  hints: number;
  /** epoch ms the card first became the active (visible) card; null until then */
  activeAt: number | null;
  key: string;
  /** JSON of the response last sent with `key` (null = nothing sent yet) */
  sentResponse: string | null;
  error: 'offline' | 'generic' | null;
  /** Set when the learner got an instant local verdict (single choice / true-false). The answer is then locked for good, even if the background submit fails. */
  instant: InstantVerdict | null;
}
export interface SubmitRequest {
  response: unknown;
  responseMs: number | undefined;
  hintsUsed: number;
  idempotencyKey: string;
}

export const initFlow = (key: string, restored?: { selected: string[]; text: string }): Flow => ({
  phase: restored ? 'graded' : 'answering',
  selected: restored?.selected ?? [],
  text: restored?.text ?? '',
  hints: 0,
  activeAt: null,
  key,
  sentResponse: null,
  error: null,
  instant: null,
});

const editable = (f: Flow) => f.phase === 'answering' && f.instant === null;

export const activate = (f: Flow, now: number): Flow =>
  f.activeAt === null ? { ...f, activeAt: now } : f;

export function select(f: Flow, id: string, multi: boolean): Flow {
  if (!editable(f)) return f;
  const selected = multi
    ? f.selected.includes(id)
      ? f.selected.filter((x) => x !== id)
      : [...f.selected, id]
    : [id];
  return { ...f, selected };
}
/** Ordering questions: tap items in order; each item can be placed once. */
export function place(f: Flow, id: string): Flow {
  return editable(f) && !f.selected.includes(id) ? { ...f, selected: [...f.selected, id] } : f;
}
export const resetOrder = (f: Flow): Flow => (editable(f) ? { ...f, selected: [] } : f);
export const setText = (f: Flow, text: string): Flow => (editable(f) ? { ...f, text } : f);
export const takeHint = (f: Flow): Flow => (editable(f) ? { ...f, hints: f.hints + 1 } : f);

/**
 * Starts a submit. Returns null (and changes nothing) if one is already in flight, the question is already graded, or the
 * answer isn't ready — which is what makes double taps harmless. A retry after a failure re-sends the SAME key when the answer
 * is unchanged (the server replays the first attempt instead of counting twice) and a NEW key when the learner changed it.
 */
export function beginSubmit(
  f: Flow,
  o: { type: string; ready: boolean; now: number; newKey: () => string },
): { state: Flow; request: SubmitRequest } | null {
  if (f.phase !== 'answering' || !o.ready) return null;
  const response = buildResponse(o.type, f.selected, f.text);
  const json = JSON.stringify(response);
  const key = f.sentResponse !== null && f.sentResponse !== json ? o.newKey() : f.key;
  return {
    state: { ...f, phase: 'submitting', key, sentResponse: json, error: null },
    request: {
      response,
      responseMs: f.activeAt === null ? undefined : Math.max(0, o.now - f.activeAt),
      hintsUsed: f.hints,
      idempotencyKey: key,
    },
  };
}
/**
 * Instant path: the learner tapped an option and already has the verdict. Locks the answer and starts the background server
 * submit in one step (same request shape, key and response-time rules as `beginSubmit`). Null if not answerable any more.
 */
export function answerInstantly(
  f: Flow,
  verdict: InstantVerdict,
  o: { type: string; now: number; newKey: () => string },
): { state: Flow; request: SubmitRequest } | null {
  if (f.phase !== 'answering' || f.instant) return null;
  const begun = beginSubmit({ ...f, selected: [verdict.tapped] }, { ...o, ready: true });
  return begun && { ...begun, state: { ...begun.state, instant: verdict } };
}
export const succeeded = (f: Flow): Flow => ({ ...f, phase: 'graded', error: null });
export const failed = (f: Flow, offline: boolean): Flow => ({
  ...f,
  phase: 'answering',
  error: offline ? 'offline' : 'generic',
});
