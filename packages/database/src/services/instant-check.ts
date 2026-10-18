import { createHash, randomBytes } from 'node:crypto';

/**
 * Instant feedback for tap-to-answer questions (single choice, true/false). Owner decision (2026-10-18): the app must show
 * right/wrong and the explanation the moment an option is tapped, with no server round trip.
 *
 * The feed therefore sends, for those questions only, `{ salt, hash, explanation }`: hash = sha256(`${salt}|${contentId}|${token}`)
 * of the CORRECT token (the option id, or 'true'/'false'). The app hashes the option the learner taps and compares. The raw key
 * is not in the payload, but a determined learner can recover the answer on their own device (few options) and read the
 * explanation before answering. That only affects their own practice: mastery, XP and reviews are still decided ONLY by the
 * server-graded `submitAnswer` (which the app calls in the background), with the existing repeat discounts and caps.
 */
export interface InstantCheck {
  salt: string;
  hash: string;
  explanation: string;
}
export const instantCheckHash = (salt: string, contentId: string, token: string) =>
  createHash('sha256').update(`${salt}|${contentId}|${token}`).digest('hex');
export const makeInstantCheck = (
  contentId: string,
  token: string,
  explanation: string,
): InstantCheck => {
  const salt = randomBytes(8).toString('hex');
  return { salt, hash: instantCheckHash(salt, contentId, token), explanation };
};
/** The token of a stored answer key for question types that support instant checks, else null. */
export function instantToken(questionType: unknown, answer: unknown): string | null {
  const a = answer as { optionId?: unknown; value?: unknown } | null;
  if (questionType === 'single_choice' && typeof a?.optionId === 'string') return a.optionId;
  if (questionType === 'true_false' && typeof a?.value === 'boolean')
    return a.value ? 'true' : 'false';
  return null;
}
