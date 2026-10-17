import { z } from 'zod';
import { isSupportedLocale, type Locale } from '@learning-loop/shared';
import { flashcardBody, imagePostBody, noteBody, questionBody, videoBody } from './content.ts';
import { toClientQuestion } from './grading.ts';

/**
 * What an ordinary creator may submit from the app. Deliberately a SUBSET of the content schemas: text-only notes,
 * flashcards and four simple question types, plus one uploaded mp4 video (registered via the media pipeline; the database
 * verifies the upload). No images in text, no tables, no cross-links.
 * The same schemas the renderer and grader use validate it, so anything accepted here can be shown and graded.
 */
export const CREATOR_KINDS = ['note', 'flashcard', 'question', 'video', 'image'] as const;
export const CREATOR_NOTE_BLOCKS = [
  'heading',
  'paragraph',
  'list',
  'callout',
  'formula',
  'revision_prompt',
] as const;
export const CREATOR_QUESTION_TYPES = [
  'single_choice',
  'true_false',
  'fill_blank',
  'numerical',
] as const;
export const CREATOR_DIFFICULTY = { easy: 0.25, medium: 0.5, hard: 0.75 } as const;
export type CreatorDifficulty = keyof typeof CREATOR_DIFFICULTY;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const head = z.object({
  kind: z.enum(CREATOR_KINDS),
  title: z.string().trim().min(3).max(200),
  language: z.string(),
  /** A curriculum concept (picked from suggestions) and/or free text: anything may be typed as the topic. */
  conceptId: uuid.optional(),
  topic: z.string().trim().min(2).max(80).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  body: z.unknown(),
  answer: z.unknown().optional(),
  explanation: z.string().optional(),
});

export interface CreatorContent {
  kind: (typeof CREATOR_KINDS)[number];
  title: string;
  language: Locale;
  /** set when the creator picked a curriculum concept; otherwise the server resolves `topic` */
  conceptId?: string;
  /** free-text topic (kept on the post as its label) */
  topic?: string;
  difficulty: number;
  format: 'note' | 'flashcard' | 'question' | 'video';
  hook: 'curiosity' | 'speed' | 'challenge';
  /** the PUBLIC body (for questions: no answer, no explanation) */
  body: Record<string, unknown>;
  /** videos and image posts: the pending uploads to finalise and attach */
  mediaIds?: string[];
  /** questions only */
  key?: { answer: unknown; explanation: string };
}
export type CreatorResult =
  { ok: true; value: CreatorContent } | { ok: false; error: string; path?: string };

const bad = (error: string, path?: string): CreatorResult => ({ ok: false, error, path });
/** Postgres jsonb/text cannot store NUL; reject it (and other control characters) anywhere in user text. */
const hasControlChars = (v: unknown): boolean =>
  typeof v === 'string'
    ? // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)
    : Array.isArray(v)
      ? v.some(hasControlChars)
      : v && typeof v === 'object'
        ? Object.values(v).some(hasControlChars)
        : false;

export function parseCreatorSubmission(input: unknown): CreatorResult {
  const h = head.safeParse(input);
  if (!h.success) return bad('invalid_submission', h.error.issues[0]?.path.join('.'));
  const s = h.data;
  if (!isSupportedLocale(s.language)) return bad('unsupported_language', 'language');
  if (hasControlChars(input)) return bad('invalid_characters');
  if (!s.conceptId && !s.topic) return bad('topic_required', 'topic');
  const base = {
    title: s.title,
    language: s.language,
    conceptId: s.conceptId,
    topic: s.topic,
    difficulty: CREATOR_DIFFICULTY[s.difficulty],
  };

  if (s.kind === 'note') {
    const n = noteBody.safeParse(s.body);
    if (!n.success) return bad('invalid_note', n.error.issues[0]?.path.join('.'));
    const disallowed = n.data.blocks.findIndex(
      (b) => !(CREATOR_NOTE_BLOCKS as readonly string[]).includes(b.type),
    );
    if (disallowed >= 0) return bad('block_not_allowed', `body.blocks.${disallowed}`);
    return {
      ok: true,
      value: { ...base, kind: 'note', format: 'note', hook: 'curiosity', body: n.data },
    };
  }
  if (s.kind === 'flashcard') {
    const f = flashcardBody.safeParse(s.body);
    if (!f.success) return bad('invalid_flashcard', f.error.issues[0]?.path.join('.'));
    if (f.data.frontMediaId || f.data.backMediaId) return bad('media_not_allowed');
    return {
      ok: true,
      value: { ...base, kind: 'flashcard', format: 'flashcard', hook: 'speed', body: f.data },
    };
  }
  if (s.kind === 'video') {
    const v = videoBody.safeParse(s.body);
    if (!v.success) return bad('invalid_video', v.error.issues[0]?.path.join('.'));
    if (v.data.posterMediaId || v.data.captionsMediaId) return bad('media_not_allowed');
    return {
      ok: true,
      value: {
        ...base,
        kind: 'video',
        format: 'video',
        hook: 'curiosity',
        body: v.data,
        mediaIds: [v.data.mediaId],
      },
    };
  }
  if (s.kind === 'image') {
    const im = imagePostBody.safeParse(s.body);
    if (!im.success) return bad('invalid_image_post', im.error.issues[0]?.path.join('.'));
    return {
      ok: true,
      value: {
        ...base,
        kind: 'image',
        format: 'note',
        hook: 'curiosity',
        body: im.data,
        mediaIds: im.data.mediaIds,
      },
    };
  }
  // question: validate the FULL shape (the same one the grader parses), then split public body from key
  const raw = { ...((s.body ?? {}) as object), answer: s.answer, explanation: s.explanation };
  const q = questionBody.safeParse(raw);
  if (!q.success) return bad('invalid_question', q.error.issues[0]?.path.join('.'));
  if (!(CREATOR_QUESTION_TYPES as readonly string[]).includes(q.data.type))
    return bad('question_type_not_allowed', 'body.type');
  if ('mediaId' in q.data && q.data.mediaId) return bad('media_not_allowed');
  const full = q.data;
  return {
    ok: true,
    value: {
      ...base,
      kind: 'question',
      format: 'question',
      hook: 'challenge',
      body: toClientQuestion(full),
      key: { answer: full.answer, explanation: full.explanation },
    },
  };
}
