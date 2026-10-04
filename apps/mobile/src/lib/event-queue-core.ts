/** Pure offline event-queue logic (no I/O) so it can be unit-tested. Persistence lives in event-queue.ts. */
export interface QueuedEvent {
  name: string;
  payload?: Record<string, unknown>;
  at: number;
}
export interface QueueState {
  events: QueuedEvent[];
  failures: number;
  nextAttemptAt: number;
}

export const MAX_QUEUE = 500;
export const BATCH = 50;

export const emptyQueue = (): QueueState => ({ events: [], failures: 0, nextAttemptAt: 0 });

export function enqueue(q: QueueState, e: QueuedEvent): QueueState {
  const events = [...q.events, e];
  // drop the OLDEST when over cap (fresh behaviour is more valuable than stale)
  return {
    ...q,
    events: events.length > MAX_QUEUE ? events.slice(events.length - MAX_QUEUE) : events,
  };
}
export const nextBatch = (q: QueueState, now: number): QueuedEvent[] =>
  now < q.nextAttemptAt ? [] : q.events.slice(0, BATCH);
export const ack = (q: QueueState, n: number): QueueState => ({
  events: q.events.slice(n),
  failures: 0,
  nextAttemptAt: 0,
});
export function fail(q: QueueState, now: number): QueueState {
  const failures = q.failures + 1;
  return { ...q, failures, nextAttemptAt: now + Math.min(300_000, 2_000 * 2 ** (failures - 1)) };
}
