import { parseCreatorSubmission } from '@learning-loop/validation';
import {
  expandMediaItem,
  isMediaEntry,
  MAX_MEDIA_FILES,
  MAX_MEDIA_MANIFEST_ITEMS,
  parseMediaItem,
  type MediaItem,
  type MediaKind,
  type PickedMedia,
  type ReadyMediaItem,
} from './bulk-media.ts';

/**
 * Bulk import of questions / flashcards / notes from a JSON file (usually written by an AI chat from content/bulk-template.json).
 * Pure functions only: every item is validated here with the SAME schema the server uses (parseCreatorSubmission), so the
 * owner sees problems before anything is uploaded. The server validates again; nothing here is trusted.
 */
export const MAX_BULK_ITEMS = 5000;
export const MAX_BULK_BYTES = 5 * 1024 * 1024;
export const BULK_CHUNK = 25;

export interface ValidItem {
  /** 0-based position of the item in the file's `items` list (show `index + 1` to people) */
  index: number;
  /** the exact request body for create-content */
  payload: Record<string, unknown>;
}
export interface BulkProblem {
  index: number;
  message: string;
}
export type BulkFatal =
  | 'empty'
  | 'too_big'
  | 'not_json'
  | 'no_items'
  | 'too_many'
  | 'bad_version'
  | 'too_many_media_items'
  | 'too_many_files';
export interface ParsedBulk {
  items: ValidItem[];
  /** picture flashcards / image posts / videos: need their files picked before they can be sent */
  media: MediaItem[];
  errors: BulkProblem[];
  /** number of items found in the file (valid + problems) */
  total: number;
  /** set when the file as a whole cannot be used */
  fatal?: BulkFatal;
}

const HEAD_KEYS = [
  'kind',
  'title',
  'language',
  'conceptId',
  'topic',
  'difficulty',
  'body',
  'answer',
  'explanation',
] as const;
const OPTION_IDS = 'abcdefgh';
const MAX_SHORTHAND_OPTIONS = 8;

/** Real UTF-8 size (Hindi is 3 bytes per character, so string length would under-count). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // surrogate pair
    } else n += 3;
  }
  return n;
}

/** Removes a UTF-8 byte-order mark and a surrounding ```json … ``` fence (chat tools often add one). */
export function cleanJsonText(text: string): string {
  let s = text.replace(/^\uFEFF/, '').trim();
  const fenced = /```[a-zA-Z]*\s*\n?([\s\S]*?)```/.exec(s);
  if (fenced) s = fenced[1]!.trim();
  return s;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** `answer` of a shorthand MCQ → index of the correct option, or an error. Letters first, then exact text, then a 1-based number. */
export function resolveShorthandAnswer(
  answer: unknown,
  options: string[],
): { ok: true; index: number } | { ok: false; message: string } {
  const n = options.length;
  const inRange = (i: number) => i >= 0 && i < n;
  if (typeof answer === 'number') {
    return Number.isInteger(answer) && inRange(answer - 1)
      ? { ok: true, index: answer - 1 }
      : { ok: false, message: `answer number ${answer} is not between 1 and ${n}` };
  }
  const a = str(answer);
  if (!a) return { ok: false, message: 'answer is missing' };
  const letter = /^\(?([A-Ha-h])[).:]?$/.exec(a);
  if (letter) {
    const i = letter[1]!.toUpperCase().charCodeAt(0) - 65;
    if (inRange(i)) return { ok: true, index: i };
  }
  const lower = a.toLowerCase();
  const byText = options.findIndex((o) => o.trim().toLowerCase() === lower);
  if (byText >= 0) return { ok: true, index: byText };
  if (/^\d{1,2}$/.test(a) && inRange(Number(a) - 1)) return { ok: true, index: Number(a) - 1 };
  return { ok: false, message: `answer "${a.slice(0, 40)}" does not match any option` };
}

type Defaults = { language?: string; topic?: string };

/** Expands the short MCQ form `{q, options, answer, explanation}` into a normal single_choice submission. */
function expandShorthand(
  it: Record<string, unknown>,
  d: Defaults,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const q = str(it.q);
  if (!q) return { ok: false, message: 'q (the question text) is missing' };
  if (!Array.isArray(it.options) || it.options.some((o) => typeof o !== 'string' || !o.trim()))
    return { ok: false, message: 'options must be a list of non-empty texts' };
  const options = (it.options as string[]).map((o) => o.trim());
  if (options.length < 2 || options.length > MAX_SHORTHAND_OPTIONS)
    return { ok: false, message: `options must have 2 to ${MAX_SHORTHAND_OPTIONS} entries` };
  const ans = resolveShorthandAnswer(it.answer, options);
  if (!ans.ok) return ans;
  const title = q.replace(/\s+/g, ' ').slice(0, 80).trim();
  return {
    ok: true,
    value: {
      kind: 'question',
      title,
      language: str(it.language) ?? d.language,
      topic: str(it.topic) ?? d.topic,
      conceptId: it.conceptId,
      difficulty: it.difficulty ?? 'medium',
      body: {
        type: 'single_choice',
        prompt: q,
        options: options.map((text, i) => ({ id: OPTION_IDS[i]!, text })),
      },
      answer: { optionId: OPTION_IDS[ans.index]! },
      explanation: it.explanation,
    },
  };
}

/** Turns one raw array entry into a validated create-content body, or a readable problem. */
export function normalizeItem(
  raw: unknown,
  d: Defaults,
): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  if (!isObj(raw)) return { ok: false, message: 'item is not an object' };
  let candidate: Record<string, unknown>;
  if ('q' in raw && !('kind' in raw)) {
    const e = expandShorthand(raw, d);
    if (!e.ok) return e;
    candidate = e.value;
  } else {
    if (raw.kind === 'video' || raw.kind === 'image')
      return {
        ok: false,
        message: `kind "${String(raw.kind)}" needs its media files (use parseBulkFile)`,
      };
    candidate = { difficulty: 'medium' };
    for (const k of HEAD_KEYS) if (raw[k] !== undefined) candidate[k] = raw[k];
    candidate.language = str(raw.language) ?? d.language;
    candidate.topic = str(raw.topic) ?? d.topic;
  }
  if (candidate.conceptId === undefined) delete candidate.conceptId;
  if (!candidate.language) return { ok: false, message: 'language is missing (set "hi" or "en")' };
  if (!candidate.topic && !candidate.conceptId)
    return { ok: false, message: 'topic is missing (set one on the item or at the top)' };
  const r = parseCreatorSubmission(candidate);
  if (!r.ok) return { ok: false, message: describe(r.error, r.path) };
  return { ok: true, payload: candidate };
}

const WHAT: Record<string, string> = {
  invalid_submission: 'a basic field is missing or wrong',
  unsupported_language: 'language must be "hi" or "en"',
  invalid_characters: 'contains a control character',
  topic_required: 'topic is missing',
  invalid_note: 'the note body is not valid',
  block_not_allowed: 'this note block type is not allowed',
  invalid_flashcard: 'the flashcard needs front and back text',
  invalid_question: 'the question is not valid (check options, answer and explanation)',
  question_type_not_allowed: 'this question type is not allowed',
  media_not_allowed: 'pictures/media cannot be used here',
};
const describe = (error: string, path?: string) =>
  `${WHAT[error] ?? error}${path ? ` (${path})` : ''}`;

/** Reads the whole file text into the items to upload and the problems found. Never throws. */
export function parseBulkFile(text: string): ParsedBulk {
  const none = (fatal: BulkFatal): ParsedBulk => ({
    items: [],
    media: [],
    errors: [],
    total: 0,
    fatal,
  });
  if (utf8Bytes(text) > MAX_BULK_BYTES) return none('too_big');
  const cleaned = cleanJsonText(text);
  if (!cleaned) return none('empty');
  let root: unknown;
  try {
    root = JSON.parse(cleaned);
  } catch {
    return none('not_json');
  }
  let list: unknown[];
  let d: Defaults = {};
  if (Array.isArray(root))
    list = root; // a bare list is fine too
  else if (isObj(root)) {
    if (root.version !== undefined && root.version !== 1) return none('bad_version');
    if (!Array.isArray(root.items)) return none('no_items');
    list = root.items;
    d = { language: str(root.language), topic: str(root.topic) };
  } else return none('no_items');
  if (!list.length) return none('no_items');
  if (list.length > MAX_BULK_ITEMS) return { ...none('too_many'), total: list.length };

  const hasMedia = list.some((raw) => isObj(raw) && isMediaEntry(raw));
  if (hasMedia && list.length > MAX_MEDIA_MANIFEST_ITEMS)
    return { ...none('too_many_media_items'), total: list.length };

  const items: ValidItem[] = [];
  const media: MediaItem[] = [];
  const errors: BulkProblem[] = [];
  list.forEach((raw, index) => {
    if (isObj(raw) && isMediaEntry(raw)) {
      const m = parseMediaItem(raw, index, d);
      if (m.ok) media.push(m.item);
      else errors.push({ index, message: m.message });
      return;
    }
    const r = normalizeItem(raw, d);
    if (r.ok) items.push({ index, payload: r.payload });
    else errors.push({ index, message: r.message });
  });
  if (media.reduce((n, m) => n + m.refs.length, 0) > MAX_MEDIA_FILES)
    return { ...none('too_many_files'), total: list.length };
  return { items, media, errors, total: list.length };
}

export function chunk<T>(items: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------- uploading ----------

export type StopReason = 'rate_limited' | 'cancelled' | 'offline' | 'rejected' | 'server';
export interface ImportProgress {
  /** items handled so far (imported + failed) */
  done: number;
  total: number;
  imported: number;
  failed: number;
  /** media uploads finished / planned (only when the import has media items) */
  files?: { done: number; total: number };
}
export interface ImportSummary {
  imported: number;
  failed: BulkProblem[];
  /** items never sent because the import stopped early */
  notSent: number;
  stopped?: StopReason;
  /** file item number (1-based) to start from to continue where it stopped */
  resumeAt?: number;
}
export type SendChunk = (
  payloads: unknown[],
) => Promise<{ results: { ok: boolean; contentId?: string; error?: string }[] }>;

const statusOf = (e: unknown): number => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : -1;
};
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends the items in chunks. A chunk that fails on a network problem (or a 5xx) is retried up to `retries` times with growing
 * waits; a rate limit (429, or a `rate_limited` row) or a rejected request stops cleanly so nothing is hammered. Per-row
 * problems never stop the import. `isCancelled` is polled between chunks (a chunk in flight is allowed to finish).
 */
export async function runBulkImport(
  items: ValidItem[],
  send: SendChunk,
  o: {
    isCancelled?: () => boolean;
    onProgress?: (p: ImportProgress) => void;
    retries?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
    size?: number;
  } = {},
): Promise<ImportSummary> {
  const retries = o.retries ?? 2;
  const backoff = o.backoffMs ?? 1500;
  const sleep = o.sleep ?? sleepMs;
  const failed: BulkProblem[] = [];
  let imported = 0;
  let sent = 0;
  const finish = (stopped?: StopReason, firstUnsent?: ValidItem): ImportSummary => ({
    imported,
    failed,
    notSent: items.length - sent,
    stopped,
    resumeAt: firstUnsent ? firstUnsent.index + 1 : undefined,
  });
  const report = () =>
    o.onProgress?.({ done: sent, total: items.length, imported, failed: failed.length });
  report();

  for (const part of chunk(items, o.size ?? BULK_CHUNK)) {
    if (o.isCancelled?.()) return finish('cancelled', part[0]);
    let res: Awaited<ReturnType<SendChunk>> | undefined;
    let lastStatus = -1;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await send(part.map((p) => p.payload));
        break;
      } catch (e) {
        lastStatus = statusOf(e);
        const retryable = lastStatus === 0 || lastStatus >= 500 || lastStatus === -1;
        if (!retryable || attempt === retries) break;
        await sleep(backoff * 2 ** attempt);
        if (o.isCancelled?.()) return finish('cancelled', part[0]);
      }
    }
    if (!res) {
      return finish(
        lastStatus === 429
          ? 'rate_limited'
          : lastStatus === 0
            ? 'offline'
            : lastStatus >= 500 || lastStatus === -1
              ? 'server'
              : 'rejected',
        part[0],
      );
    }
    let stoppedAt: ValidItem | undefined;
    part.forEach((p, i) => {
      if (stoppedAt) return;
      const r = res!.results[i];
      if (!r || r.error === 'rate_limited') {
        stoppedAt = p; // the server stopped before this row, which was not stored
        return;
      }
      sent++;
      if (r.ok) imported++;
      else failed.push({ index: p.index, message: r.error ?? 'error' });
    });
    report();
    if (stoppedAt) return finish('rate_limited', stoppedAt);
  }
  return finish();
}

// ---------- importing with media ----------

export type ImportEntry = ValidItem | ReadyMediaItem;
const isMediaEntryItem = (e: ImportEntry): e is ReadyMediaItem => 'files' in e;
/** Uploads ONE file (own folder, `pending`) and returns its media id (and the measured length for a video). */
export type UploadFile = (
  file: PickedMedia,
  kind: MediaKind,
  knownDurationMs?: number,
) => Promise<{ mediaId: string; durationMs?: number }>;

/**
 * Like `runBulkImport` but some entries are media items: their files are uploaded one at a time (sequentially, so only one file
 * is in memory), then the create-content bodies go out in chunks. Each reference is uploaded again (the server attaches a media
 * row to a single post). A file upload is retried on network errors/5xx with backoff; 429 stops as `rate_limited`; another
 * 4xx fails just that item. Media that was uploaded but never attached stays private in the owner's own folder (harmless).
 */
export async function runMixedImport(
  entries: ImportEntry[],
  send: SendChunk,
  upload: UploadFile,
  o: {
    isCancelled?: () => boolean;
    onProgress?: (p: ImportProgress) => void;
    retries?: number;
    backoffMs?: number;
    sleep?: (ms: number) => Promise<void>;
    size?: number;
  } = {},
): Promise<ImportSummary> {
  const retries = o.retries ?? 2;
  const backoff = o.backoffMs ?? 1500;
  const sleep = o.sleep ?? sleepMs;
  const totalFiles = entries.reduce((n, e) => n + (isMediaEntryItem(e) ? e.files.length : 0), 0);
  const failed: BulkProblem[] = [];
  let imported = 0;
  let handled = 0;
  let filesDone = 0;
  const report = (extra = { done: 0, imported: 0, failed: 0 }) =>
    o.onProgress?.({
      done: handled + extra.done,
      total: entries.length,
      imported: imported + extra.imported,
      failed: failed.length + extra.failed,
      ...(totalFiles ? { files: { done: filesDone, total: totalFiles } } : {}),
    });
  const finish = (stopped?: StopReason, resumeAt?: number): ImportSummary => ({
    imported,
    failed,
    notSent: entries.length - handled,
    stopped,
    resumeAt,
  });

  type Prepared =
    | { ok: true; payload: Record<string, unknown> }
    | { ok: false; stop: StopReason }
    | { ok: false; message: string };
  const prepare = async (e: ReadyMediaItem): Promise<Prepared> => {
    const ids: string[] = [];
    let measured: number | undefined;
    for (let i = 0; i < e.files.length; i++) {
      const ref = e.refs[i]!;
      let lastStatus = -1;
      let done = false;
      for (let attempt = 0; attempt <= retries && !done; attempt++) {
        if (o.isCancelled?.()) return { ok: false, stop: 'cancelled' };
        try {
          const r = await upload(e.files[i]!, ref.kind, e.durationMs);
          ids.push(r.mediaId);
          if (r.durationMs) measured = r.durationMs;
          filesDone++;
          report();
          done = true;
        } catch (err) {
          lastStatus = statusOf(err);
          const retryable = lastStatus === 0 || lastStatus >= 500 || lastStatus === -1;
          if (!retryable) break;
          if (attempt < retries) await sleep(backoff * 2 ** attempt);
        }
      }
      if (!done) {
        if (lastStatus === 429) return { ok: false, stop: 'rate_limited' };
        if (lastStatus === 0 || lastStatus === -1) return { ok: false, stop: 'offline' };
        if (lastStatus >= 500) return { ok: false, stop: 'server' };
        return { ok: false, message: `could not upload ${e.files[i]!.name} (error ${lastStatus})` };
      }
    }
    return { ok: true, payload: expandMediaItem(e, ids, measured) };
  };

  report();
  for (const group of chunk(entries, o.size ?? BULK_CHUNK)) {
    const prepared: ValidItem[] = [];
    let stop: { reason: StopReason; at: ImportEntry } | undefined;
    for (const e of group) {
      if (o.isCancelled?.()) {
        stop = { reason: 'cancelled', at: e };
        break;
      }
      if (!isMediaEntryItem(e)) {
        prepared.push(e);
        continue;
      }
      const r = await prepare(e);
      if (r.ok) prepared.push({ index: e.index, payload: r.payload });
      else if ('stop' in r) {
        stop = { reason: r.stop, at: e };
        break;
      } else {
        failed.push({ index: e.index, message: r.message });
        handled++;
        report();
      }
    }
    if (prepared.length) {
      const base = { imported, failed: failed.length, handled };
      const s = await runBulkImport(prepared, send, {
        ...o,
        size: prepared.length,
        isCancelled: undefined, // everything prepared in this group is sent
        onProgress: (p) =>
          o.onProgress?.({
            done: base.handled + p.done,
            total: entries.length,
            imported: base.imported + p.imported,
            failed: base.failed + p.failed,
            ...(totalFiles ? { files: { done: filesDone, total: totalFiles } } : {}),
          }),
      });
      imported += s.imported;
      failed.push(...s.failed);
      handled += prepared.length - s.notSent;
      if (s.stopped) return finish(s.stopped, s.resumeAt);
    }
    if (stop) return finish(stop.reason, stop.at.index + 1);
  }
  return finish();
}
