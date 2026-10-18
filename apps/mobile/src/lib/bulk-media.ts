import { parseCreatorSubmission } from '@learning-loop/validation';
import { MAX_IMAGE_BYTES, MAX_IMAGES, MAX_VIDEO_BYTES } from './creator-form';

/**
 * Bulk import of MEDIA posts (picture flashcards, image posts, videos). Pure functions only (no native imports) so they are unit
 * tested: manifest parsing for the three media kinds, matching manifest file names to the files the owner picked, problem
 * detection and expansion into the create-content body once the media ids are known.
 */
export const MAX_MEDIA_MANIFEST_ITEMS = 2000;
export const MAX_MEDIA_FILES = 600;
export { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES };

export type MediaKind = 'image' | 'video';
export type MediaItemKind = 'flashcard' | 'image' | 'video';
export interface MediaRef {
  /** file name exactly as written in the manifest */
  name: string;
  kind: MediaKind;
}
export interface MediaItem {
  /** 0-based position in the manifest's `items` list */
  index: number;
  kind: MediaItemKind;
  /** kind/title/language/topic/difficulty/conceptId for create-content */
  head: Record<string, unknown>;
  /** in upload order: flashcard = [front, back]; image = the pages; video = [file] */
  refs: MediaRef[];
  frontText?: string;
  backText?: string;
  caption?: string;
  /** from `durationSeconds`; when absent the app measures the file */
  durationMs?: number;
}
export interface PickedMedia {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}
export interface ReadyMediaItem extends MediaItem {
  /** matched picked files, same order as `refs` (each reference is uploaded on its own) */
  files: PickedMedia[];
}

const IMAGE_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const VIDEO_EXT: Record<string, string> = { mp4: 'video/mp4' };
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const PLACEHOLDER_ID = 'placeholder-media-id';
const HEAD_KEYS = ['kind', 'title', 'language', 'conceptId', 'topic', 'difficulty'] as const;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Folder-less, case-insensitive, Unicode-normalised key used to match manifest names to picked files. */
export function fileKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.normalize('NFC').trim().toLowerCase();
}
const extOf = (name: string): string => {
  const k = fileKey(name);
  const i = k.lastIndexOf('.');
  return i >= 0 ? k.slice(i + 1) : '';
};
export const mimeFromName = (name: string, kind: MediaKind): string | undefined =>
  (kind === 'image' ? IMAGE_EXT : VIDEO_EXT)[extOf(name)];

type Defaults = { language?: string; topic?: string };
type Parsed = { ok: true; item: MediaItem } | { ok: false; message: string };

/** True for the manifest entries this module handles (otherwise the normal text parser does). */
export function isMediaEntry(raw: Record<string, unknown>): boolean {
  if (raw.kind === 'image' || raw.kind === 'video') return true;
  return (
    raw.kind === 'flashcard' &&
    raw.body === undefined &&
    typeof raw.front === 'string' &&
    typeof raw.back === 'string'
  );
}

function ref(v: unknown, kind: MediaKind, label: string): MediaRef | string {
  const name = str(v);
  if (!name) return `${label} is missing (the file name)`;
  if (!mimeFromName(name, kind))
    return kind === 'image'
      ? `${label} "${name.slice(0, 60)}" must be a .jpg, .png or .webp picture`
      : `${label} "${name.slice(0, 60)}" must be an .mp4 video`;
  return { name, kind };
}

/** Builds the create-content body for a media item once its media ids are known (ids in the order of `refs`). */
export function expandMediaItem(
  item: MediaItem,
  mediaIds: string[],
  measuredDurationMs?: number,
): Record<string, unknown> {
  const p: Record<string, unknown> = { ...item.head };
  if (item.kind === 'flashcard') {
    const title = String(item.head.title ?? '');
    p.body = {
      front: item.frontText ?? title,
      back: item.backText ?? title,
      frontMediaId: mediaIds[0],
      backMediaId: mediaIds[1],
    };
  } else if (item.kind === 'image') {
    p.body = { mediaIds, ...(item.caption ? { caption: item.caption } : {}) };
  } else {
    p.body = { mediaId: mediaIds[0], durationMs: item.durationMs ?? measuredDurationMs ?? 30_000 };
  }
  return p;
}

/** Validates one media entry from the manifest (file names, extensions, text) with the SAME schema as the server. */
export function parseMediaItem(raw: Record<string, unknown>, index: number, d: Defaults): Parsed {
  const kind = raw.kind as MediaItemKind;
  const head: Record<string, unknown> = { difficulty: 'medium' };
  for (const k of HEAD_KEYS) if (raw[k] !== undefined) head[k] = raw[k];
  head.language = str(raw.language) ?? d.language;
  head.topic = str(raw.topic) ?? d.topic;
  if (head.conceptId === undefined) delete head.conceptId;
  if (!head.language) return { ok: false, message: 'language is missing (set "hi" or "en")' };
  if (!head.topic && !head.conceptId)
    return { ok: false, message: 'topic is missing (set one on the item or at the top)' };

  const item: MediaItem = { index, kind, head, refs: [] };
  const add = (r: MediaRef | string): string | undefined => {
    if (typeof r === 'string') return r;
    item.refs.push(r);
    return undefined;
  };
  let err: string | undefined;
  if (kind === 'flashcard') {
    err = add(ref(raw.front, 'image', 'front')) ?? add(ref(raw.back, 'image', 'back'));
    item.frontText = str(raw.frontText);
    item.backText = str(raw.backText);
  } else if (kind === 'image') {
    if (!Array.isArray(raw.images) || !raw.images.length)
      err = 'images must be a list of picture file names';
    else if (raw.images.length > MAX_IMAGES) err = `at most ${MAX_IMAGES} pictures per post`;
    else
      for (const [i, v] of raw.images.entries()) {
        err = add(ref(v, 'image', `images[${i + 1}]`));
        if (err) break;
      }
    item.caption = str(raw.caption);
  } else {
    err = add(ref(raw.file, 'video', 'file'));
    if (!err && raw.durationSeconds !== undefined) {
      const s = raw.durationSeconds;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 1 || s > 900)
        err = 'durationSeconds must be a number between 1 and 900';
      else item.durationMs = Math.round(s * 1000);
    }
  }
  if (err) return { ok: false, message: err };
  const ids = item.refs.map(() => PLACEHOLDER_ID);
  const r = parseCreatorSubmission(expandMediaItem(item, ids));
  if (!r.ok) return { ok: false, message: `${r.error}${r.path ? ` (${r.path})` : ''}` };
  return { ok: true, item };
}

// ---------- matching picked files to the manifest ----------

export interface BadFile {
  name: string;
  reason: 'type' | 'size';
}
export interface MediaPlan {
  /** items whose files were all found and are usable */
  ready: ReadyMediaItem[];
  /** items left out, with a readable reason (index is 0-based) */
  skipped: { index: number; message: string }[];
  /** referenced file names that were not among the picked files (unique, manifest spelling) */
  missing: string[];
  /** picked files no item refers to */
  unused: string[];
  /** referenced picked files that are the wrong type or too big / empty */
  badFiles: BadFile[];
  /** names picked more than once (the first one is used) */
  duplicates: string[];
}

function fileProblem(f: PickedMedia, kind: MediaKind): { mime?: string; bad?: 'type' | 'size' } {
  const allowed = kind === 'image' ? IMAGE_MIMES : ['video/mp4'];
  const picked = f.mimeType.trim().toLowerCase();
  let mime: string | undefined;
  if (allowed.includes(picked)) mime = picked;
  else if (!picked || picked === 'application/octet-stream') mime = mimeFromName(f.name, kind);
  if (!mime) return { bad: 'type' };
  const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (f.size <= 0 || f.size > max) return { bad: 'size' };
  return { mime };
}

const mb = (n: number) => `${Math.round((n / 1048576) * 10) / 10} MB`;

/** Matches manifest references to picked files by exact base name (case-insensitive, folders ignored). */
export function buildMediaPlan(items: MediaItem[], picked: PickedMedia[]): MediaPlan {
  const byKey = new Map<string, PickedMedia>();
  const duplicates: string[] = [];
  for (const f of picked) {
    const k = fileKey(f.name);
    if (byKey.has(k)) duplicates.push(f.name);
    else byKey.set(k, f);
  }
  const used = new Set<string>();
  const missing = new Map<string, string>();
  const bad = new Map<string, BadFile>();
  const ready: ReadyMediaItem[] = [];
  const skipped: MediaPlan['skipped'] = [];

  for (const it of items) {
    const files: PickedMedia[] = [];
    let message: string | undefined;
    for (const r of it.refs) {
      const k = fileKey(r.name);
      const f = byKey.get(k);
      if (!f) {
        missing.set(k, r.name);
        message ??= `file not found among the selected files: ${r.name}`;
        continue;
      }
      used.add(k);
      const p = fileProblem(f, r.kind);
      if (p.bad) {
        bad.set(k, { name: f.name, reason: p.bad });
        message ??=
          p.bad === 'type'
            ? `${f.name} is not a supported ${r.kind === 'image' ? 'JPG/PNG/WebP picture' : 'MP4 video'}`
            : `${f.name} is empty or too big (${mb(f.size)}; max ${mb(r.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)})`;
        continue;
      }
      files.push({ ...f, mimeType: p.mime! });
    }
    if (message) skipped.push({ index: it.index, message });
    else ready.push({ ...it, files });
  }
  const unused = [...byKey.entries()].filter(([k]) => !used.has(k)).map(([, f]) => f.name);
  return {
    ready,
    skipped,
    missing: [...missing.values()],
    unused,
    badFiles: [...bad.values()],
    duplicates,
  };
}

/** Number of uploads and bytes for these items (each reference is uploaded on its own). */
export function uploadStats(items: ReadyMediaItem[]): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const it of items)
    for (const f of it.files) {
      files++;
      bytes += f.size;
    }
  return { files, bytes };
}
