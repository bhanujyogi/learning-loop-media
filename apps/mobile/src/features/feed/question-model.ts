import type { ChoiceState } from '../../ui/primitives';

export interface Opt {
  id: string;
  text: string;
}
export interface PublicQuestion {
  type: string;
  prompt: string;
  options?: Opt[];
  items?: Opt[];
  hint?: string;
}

/** Question types this app version can render AND answer. Others show a truthful "unsupported" state. */
export const SUPPORTED_QUESTION_TYPES = [
  'single_choice',
  'image_based',
  'application',
  'multi_choice',
  'true_false',
  'fill_blank',
  'numerical',
  'ordering',
] as const;
export const isSupportedQuestion = (type: string) =>
  (SUPPORTED_QUESTION_TYPES as readonly string[]).includes(type);

export type Verdict = 'correct' | 'partial' | 'incorrect';
export const verdictOf = (r: { correct: boolean; score: number }): Verdict =>
  r.correct ? 'correct' : r.score > 0 ? 'partial' : 'incorrect';

/** The response payload the server's `gradeAnswer` expects for each question type. */
export function buildResponse(type: string, selected: string[], text: string): unknown {
  switch (type) {
    case 'true_false':
      return { value: selected[0] === 'true' };
    case 'multi_choice':
      return { optionIds: selected };
    case 'numerical':
      return { value: Number(text) };
    case 'fill_blank':
      return { value: text };
    case 'ordering':
      return { order: selected };
    default:
      return { optionId: selected[0] };
  }
}

export function isReady(q: PublicQuestion, selected: string[], text: string): boolean {
  if (q.type === 'fill_blank') return text.trim().length > 0;
  if (q.type === 'numerical') return text.trim().length > 0 && Number.isFinite(Number(text));
  if (q.type === 'ordering') return selected.length === (q.items?.length ?? 0);
  return selected.length > 0;
}

/**
 * After grading, how each option should look. `correctAnswer` is the server's answer key, returned only AFTER the attempt.
 * wrong = you picked it and it's incorrect; missed = it was right but you didn't pick it; correct = you picked a right one.
 */
export function optionStates(
  type: string,
  options: Opt[],
  selected: string[],
  correctAnswer: unknown,
): Record<string, ChoiceState> {
  const key = (correctAnswer ?? {}) as { optionId?: string; optionIds?: string[]; value?: boolean };
  const right = new Set<string>(
    type === 'multi_choice'
      ? (key.optionIds ?? [])
      : type === 'true_false'
        ? [String(key.value)]
        : key.optionId
          ? [key.optionId]
          : [],
  );
  const out: Record<string, ChoiceState> = {};
  for (const o of options) {
    const picked = selected.includes(o.id);
    out[o.id] = right.has(o.id) ? (picked ? 'correct' : 'missed') : picked ? 'wrong' : 'idle';
  }
  return out;
}

/** Human-readable right answer for text/number/order questions (choice questions highlight their options instead). */
export function describeCorrectAnswer(q: PublicQuestion, correctAnswer: unknown): string | null {
  const a = (correctAnswer ?? {}) as { accepted?: string[]; value?: number; order?: string[] };
  switch (q.type) {
    case 'fill_blank':
      return a.accepted?.[0] ?? null;
    case 'numerical':
      return typeof a.value === 'number' ? String(a.value) : null;
    case 'ordering': {
      const byId = new Map((q.items ?? []).map((i) => [i.id, i.text]));
      return a.order ? a.order.map((id, i) => `${i + 1}. ${byId.get(id) ?? id}`).join('\n') : null;
    }
    default:
      return null;
  }
}
