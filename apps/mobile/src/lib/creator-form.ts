import type { Locale } from '@learning-loop/shared';

export type CreatorKind = 'note' | 'flashcard' | 'question';
export type QuestionType = 'single_choice' | 'true_false' | 'fill_blank' | 'numerical';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface CreatorForm {
  kind: CreatorKind;
  title: string;
  language: Locale;
  conceptId?: string;
  difficulty: Difficulty;
  noteText: string;
  front: string;
  back: string;
  qType: QuestionType;
  prompt: string;
  options: string[];
  /** index into `options` */
  correct: number | null;
  tf: boolean | null;
  accepted: string;
  numValue: string;
  tolerance: string;
  explanation: string;
  confirmed: boolean;
}
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export const emptyForm = (language: Locale, kind: CreatorKind = 'note'): CreatorForm => ({
  kind,
  title: '',
  language,
  difficulty: 'medium',
  noteText: '',
  front: '',
  back: '',
  qType: 'single_choice',
  prompt: '',
  options: ['', ''],
  correct: null,
  tf: null,
  accepted: '',
  numValue: '',
  tolerance: '',
  explanation: '',
  confirmed: false,
});

export type FormError =
  | 'title'
  | 'concept'
  | 'noteText'
  | 'front'
  | 'back'
  | 'prompt'
  | 'options'
  | 'correct'
  | 'tf'
  | 'accepted'
  | 'num'
  | 'explanation'
  | 'confirm';

const ids = 'abcdefghijklmnop';
/** `# Heading` lines become headings; blank lines separate paragraphs. */
export function noteBlocks(text: string): { type: string; level?: number; text: string }[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      p.startsWith('# ') && !p.includes('\n')
        ? { type: 'heading', level: 2, text: p.slice(2).trim() }
        : { type: 'paragraph', text: p },
    )
    .filter((b) => b.text.length > 0);
}
const filled = (s: string) => s.trim().length > 0;

/**
 * Turns the form into the body of the `create-content` request, or lists what is missing. The SERVER validates again with
 * the shared content schemas (and a drift test proves everything built here passes them); this only gives instant feedback.
 */
export function buildSubmission(
  f: CreatorForm,
): { ok: true; payload: Record<string, unknown> } | { ok: false; errors: FormError[] } {
  const errors: FormError[] = [];
  if (f.title.trim().length < 3) errors.push('title');
  if (!f.conceptId) errors.push('concept');
  if (!f.confirmed) errors.push('confirm');
  const head = {
    kind: f.kind,
    title: f.title.trim(),
    language: f.language,
    conceptId: f.conceptId,
    difficulty: f.difficulty,
  };

  if (f.kind === 'note') {
    const blocks = noteBlocks(f.noteText);
    if (!blocks.length) errors.push('noteText');
    return errors.length
      ? { ok: false, errors }
      : { ok: true, payload: { ...head, body: { blocks } } };
  }
  if (f.kind === 'flashcard') {
    if (!filled(f.front)) errors.push('front');
    if (!filled(f.back)) errors.push('back');
    return errors.length
      ? { ok: false, errors }
      : { ok: true, payload: { ...head, body: { front: f.front.trim(), back: f.back.trim() } } };
  }

  // question
  if (!filled(f.prompt)) errors.push('prompt');
  if (!filled(f.explanation)) errors.push('explanation');
  let body: Record<string, unknown> = { type: f.qType, prompt: f.prompt.trim() };
  let answer: unknown;
  if (f.qType === 'single_choice') {
    const kept = f.options.map((text, i) => ({ text: text.trim(), i })).filter((o) => o.text);
    if (kept.length < MIN_OPTIONS) errors.push('options');
    const pos = kept.findIndex((o) => o.i === f.correct);
    if (pos < 0) errors.push('correct');
    else answer = { optionId: ids[pos] };
    body = { ...body, options: kept.map((o, n) => ({ id: ids[n], text: o.text })) };
  } else if (f.qType === 'true_false') {
    if (f.tf === null) errors.push('tf');
    else answer = { value: f.tf };
  } else if (f.qType === 'fill_blank') {
    const accepted = f.accepted
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (!accepted.length) errors.push('accepted');
    answer = { accepted };
  } else {
    const value = Number(f.numValue);
    const tolerance = f.tolerance.trim() === '' ? 0 : Number(f.tolerance);
    if (
      f.numValue.trim() === '' ||
      !Number.isFinite(value) ||
      !Number.isFinite(tolerance) ||
      tolerance < 0
    )
      errors.push('num');
    else answer = { value, tolerance };
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, payload: { ...head, body, answer, explanation: f.explanation.trim() } };
}

/** Status shown to the creator for one of their posts. */
export type PostStatus = 'live' | 'pending' | 'removed' | 'hidden';
export function postStatus(p: { publishing: string; moderation: string }): PostStatus {
  if (p.moderation === 'removed' || p.moderation === 'restricted') return 'removed';
  if (p.publishing !== 'published') return 'hidden';
  if (p.moderation === 'cleared' || p.moderation === 'none') return 'live';
  if (p.moderation === 'pending_review') return 'pending';
  return 'hidden'; // flagged / appealed: not visible to others
}
