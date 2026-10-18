import type { ChoiceState } from '../ui/primitives';
import { sha256Hex } from './sha256';

/**
 * Instant right/wrong for tap-to-answer questions (single choice, true/false). The feed sends `{ salt, hash, explanation }`;
 * hash = sha256(`${salt}|${contentId}|${token}`) of the CORRECT token (option id, or 'true'/'false'). The server-side twin is
 * packages/database/src/services/instant-check.ts (parity is tested). This is a UX shortcut only: mastery, XP and reviews are
 * decided by the server-graded submit-answer, which the card still calls in the background.
 */
export interface InstantCheck {
  salt: string;
  hash: string;
  explanation: string;
}
export interface InstantVerdict {
  /** the option the learner tapped */
  tapped: string;
  correct: boolean;
  correctToken: string;
  explanation: string;
}

export const INSTANT_TYPES = ['single_choice', 'true_false'] as const;
export const supportsInstant = (type: string) =>
  (INSTANT_TYPES as readonly string[]).includes(type);

export const instantHash = (salt: string, contentId: string, token: string) =>
  sha256Hex(`${salt}|${contentId}|${token}`);

/** Defensive shape check: older cached items or malformed data simply fall back to the server flow. */
export function isInstantCheck(v: unknown): v is InstantCheck {
  const c = v as Partial<InstantCheck> | null | undefined;
  return (
    !!c &&
    typeof c.salt === 'string' &&
    c.salt.length > 0 &&
    typeof c.hash === 'string' &&
    /^[0-9a-f]{64}$/.test(c.hash) &&
    typeof c.explanation === 'string'
  );
}

/** The one token whose hash matches, or null (tampered hash, wrong content id, no match → use the server flow). */
export function findCorrectToken(
  ic: unknown,
  contentId: string,
  tokens: readonly string[],
): string | null {
  if (!isInstantCheck(ic)) return null;
  const matches = tokens.filter((t) => instantHash(ic.salt, contentId, t) === ic.hash);
  return matches.length === 1 ? matches[0]! : null;
}

/** Verdict for a tapped token, or null when an instant verdict can't be established (caller uses the server flow). */
export function instantVerdict(
  ic: unknown,
  contentId: string,
  tokens: readonly string[],
  tapped: string,
): InstantVerdict | null {
  if (!isInstantCheck(ic) || !tokens.includes(tapped)) return null;
  const correctToken = findCorrectToken(ic, contentId, tokens);
  if (correctToken === null) return null;
  return {
    tapped,
    correct: tapped === correctToken,
    correctToken,
    explanation: ic.explanation,
  };
}

/** Option look after an instant verdict: tapped-wrong, the correct one (picked or missed); the rest stay idle (dimmed by the UI). */
export function instantStates(
  tokens: readonly string[],
  v: Pick<InstantVerdict, 'tapped' | 'correctToken'>,
): Record<string, ChoiceState> {
  const out: Record<string, ChoiceState> = {};
  for (const t of tokens)
    out[t] =
      t === v.correctToken
        ? t === v.tapped
          ? 'correct'
          : 'missed'
        : t === v.tapped
          ? 'wrong'
          : 'idle';
  return out;
}
