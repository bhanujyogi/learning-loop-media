import type { Locale } from '@learning-loop/shared';

export type CreatorKind = 'note' | 'flashcard' | 'question' | 'image' | 'video';

/** An image the creator picked (uploaded only when they press Post). Same shape as `PickedFile` in lib/upload.ts. */
export interface PickedImage {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}
export const MAX_IMAGES = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // keep equal to lib/upload.ts (that file imports native modules, this one stays pure)
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
/** Why a picked image can't be used (null = fine). Mirrors `imageProblem` in lib/upload.ts. */
export const imageFileProblem = (f: PickedImage): 'type' | 'size' | null =>
  !IMAGE_MIME.includes(f.mimeType)
    ? 'type'
    : f.size <= 0 || f.size > MAX_IMAGE_BYTES
      ? 'size'
      : null;
export const MIN_TOPIC = 2;
export const MAX_TOPIC = 80;

/** A video the creator picked on their phone (uploaded only when they press Post). */
export interface PickedVideo {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
export const videoProblem = (
  v: PickedVideo | undefined,
): 'video' | 'videoType' | 'videoSize' | null =>
  !v
    ? 'video'
    : v.mimeType !== 'video/mp4'
      ? 'videoType'
      : v.size > MAX_VIDEO_BYTES || v.size <= 0
        ? 'videoSize'
        : null;
export type QuestionType = 'single_choice' | 'true_false' | 'fill_blank' | 'numerical';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface CreatorForm {
  kind: CreatorKind;
  title: string;
  language: Locale;
  /** free-text "what does it teach" (2–80 characters) */
  topic: string;
  /** set only when the creator tapped a curriculum suggestion; typing anything else clears it */
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
  video?: PickedVideo;
  images: PickedImage[];
  caption: string;
}
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export const emptyForm = (language: Locale, kind: CreatorKind = 'note'): CreatorForm => ({
  kind,
  title: '',
  language,
  topic: '',
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
  images: [],
  caption: '',
});

export type FormError =
  | 'title'
  | 'topic'
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
  | 'video'
  | 'videoType'
  | 'videoSize'
  | 'images'
  | 'imageType'
  | 'imageSize'
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
  const topic = f.topic.trim();
  if (topic.length < MIN_TOPIC || topic.length > MAX_TOPIC) errors.push('topic');
  if (!f.confirmed) errors.push('confirm');
  const head: Record<string, unknown> = {
    kind: f.kind,
    title: f.title.trim(),
    language: f.language,
    topic,
    difficulty: f.difficulty,
  };
  if (f.conceptId) head.conceptId = f.conceptId;

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

  if (f.kind === 'video') {
    const v = videoProblem(f.video);
    if (v) errors.push(v);
    // the body needs the id of the uploaded file, so the screen completes it after the upload (see lib/video-upload.ts)
    return errors.length ? { ok: false, errors } : { ok: true, payload: { ...head, body: {} } };
  }

  if (f.kind === 'image') {
    if (!f.images.length || f.images.length > MAX_IMAGES) errors.push('images');
    else if (f.images.some((i) => imageFileProblem(i) === 'type')) errors.push('imageType');
    else if (f.images.some((i) => imageFileProblem(i) === 'size')) errors.push('imageSize');
    const caption = f.caption.trim();
    // the body needs the ids of the uploaded files, so the screen adds `mediaIds` after the uploads (see lib/upload.ts)
    return errors.length
      ? { ok: false, errors }
      : { ok: true, payload: { ...head, body: caption ? { caption } : {} } };
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
