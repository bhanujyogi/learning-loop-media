import { createHash } from 'node:crypto';
import { RATE_LIMITS } from '@learning-loop/config';
import type { JobStatus } from '@learning-loop/shared';

/** Deterministic idempotency key: retries of the same logical publish never duplicate. */
export const publishIdempotencyKey = (p: {
  publisherId: string;
  contentKey: string;
  contentVersion: number;
}): string =>
  createHash('sha256')
    .update(`${p.publisherId}|${p.contentKey}|v${p.contentVersion}`)
    .digest('hex');

export interface BatchGuardInput {
  /** items in this publish batch */
  size: number;
  /** items published by this identity within the rate window */
  recentCount: number;
  /** hard cap per batch */
  maxBatch?: number;
}
export interface BatchGuardResult {
  allowed: boolean;
  reason?: string;
  allowedCount: number;
}

export function guardBatch({
  size,
  recentCount,
  maxBatch = 25,
}: BatchGuardInput): BatchGuardResult {
  if (size <= 0) return { allowed: false, reason: 'empty batch', allowedCount: 0 };
  if (size > maxBatch)
    return { allowed: false, reason: `batch exceeds ${maxBatch}`, allowedCount: 0 };
  const budget = RATE_LIMITS.official_publish.max - recentCount;
  if (budget <= 0)
    return { allowed: false, reason: 'publisher rate limit reached', allowedCount: 0 };
  if (size > budget)
    return { allowed: false, reason: `only ${budget} publishes left in window`, allowedCount: 0 };
  return { allowed: true, allowedCount: size };
}

/** Job state machine shared by ingestion / generation / publishing jobs. */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'retrying', 'cancelled'],
  retrying: ['running', 'failed', 'cancelled'],
  failed: ['retrying'],
  completed: [],
  cancelled: [],
};
export const canTransition = (from: JobStatus, to: JobStatus): boolean =>
  TRANSITIONS[from].includes(to);

export function nextRetryDelayMs(attempt: number, base = 2_000, cap = 600_000): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
}

/** Strip anything secret-looking from error messages before persisting job errors. */
export function sanitizeError(message: string): string {
  return message
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]')
    .replace(
      /(apikey|api_key|secret|token|password|authorization)(["'\s:=]+)[^\s"',}]+/gi,
      '$1$2[redacted]',
    )
    .slice(0, 2000);
}
