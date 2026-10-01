import type { QuestionBody } from './content';

export interface GradeResult {
  correct: boolean;
  /** 0..1 partial credit (multi/matching/ordering) */
  score: number;
}

const norm = (s: string, cs: boolean) =>
  cs ? s.trim() : s.trim().toLowerCase().replace(/\s+/g, ' ');
const setEq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Server-side grading. Never ship this answer key to clients (see toClientQuestion). */
export function gradeAnswer(q: QuestionBody, response: unknown): GradeResult {
  const r = (response ?? {}) as Record<string, unknown>;
  const result = (score: number): GradeResult => ({ correct: score === 1, score });
  switch (q.type) {
    case 'single_choice':
    case 'image_based':
    case 'application':
      return result(r.optionId === q.answer.optionId ? 1 : 0);
    case 'multi_choice': {
      const sel = Array.isArray(r.optionIds) ? (r.optionIds as string[]) : [];
      if (setEq(sel, q.answer.optionIds)) return result(1);
      const right = sel.filter((x) => q.answer.optionIds.includes(x)).length;
      const wrong = sel.length - right;
      return { correct: false, score: Math.max(0, (right - wrong) / q.answer.optionIds.length) };
    }
    case 'true_false':
      return result(r.value === q.answer.value ? 1 : 0);
    case 'fill_blank': {
      const v = typeof r.value === 'string' ? norm(r.value, q.answer.caseSensitive) : '';
      return result(q.answer.accepted.some((a) => norm(a, q.answer.caseSensitive) === v) ? 1 : 0);
    }
    case 'numerical': {
      const v = typeof r.value === 'number' ? r.value : Number.NaN;
      return result(
        Number.isFinite(v) && Math.abs(v - q.answer.value) <= q.answer.tolerance ? 1 : 0,
      );
    }
    case 'matching': {
      const pairs = Array.isArray(r.pairs) ? (r.pairs as { left: string; right: string }[]) : [];
      const ok = pairs.filter((p) =>
        q.answer.pairs.some((a) => a.left === p.left && a.right === p.right),
      ).length;
      return result(
        ok === q.answer.pairs.length && pairs.length === ok
          ? 1
          : Math.min(0.99, ok / q.answer.pairs.length),
      );
    }
    case 'ordering': {
      const order = Array.isArray(r.order) ? (r.order as string[]) : [];
      const exact =
        order.length === q.answer.order.length && order.every((x, i) => x === q.answer.order[i]);
      if (exact) return result(1);
      const pos = order.filter((x, i) => q.answer.order[i] === x).length;
      return { correct: false, score: Math.min(0.99, pos / q.answer.order.length) };
    }
    case 'map_based':
      return result(r.regionId === q.answer.regionId ? 1 : 0);
  }
}

/** Strip answer key + explanation: what a client may see BEFORE answering. */
export function toClientQuestion(q: QuestionBody): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...q };
  delete rest.answer;
  delete rest.explanation;
  if (q.type === 'ordering') {
    // Present items in a deterministic non-answer order so the key isn't leaked by position.
    const items = [...q.items].sort((a, b) => a.id.localeCompare(b.id));
    const sameAsAnswer = items.every((x, i) => x.id === q.answer.order[i]);
    return { ...rest, items: sameAsAnswer ? [...items].reverse() : items };
  }
  return rest;
}
