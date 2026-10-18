import { parseCreatorSubmission } from '@learning-loop/validation';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBulkFile, runMixedImport, type ImportEntry } from './bulk-import';
import {
  buildMediaPlan,
  expandMediaItem,
  fileKey,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  uploadStats,
  type PickedMedia,
} from './bulk-media';

const manifest = (items: unknown[], extra: object = {}) =>
  JSON.stringify({ version: 1, language: 'hi', topic: 'सामान्य ज्ञान', items, ...extra });
const pic = (name: string, size = 1000, mimeType = 'image/png'): PickedMedia => ({
  uri: `file:///cache/${name}`,
  name,
  size,
  mimeType,
});
const card = (n: number) => ({
  kind: 'flashcard',
  title: `कार्ड ${n}`,
  front: `card-${n}-front.png`,
  back: `card-${n}-back.png`,
});

describe('media manifest parsing', () => {
  it('parses picture flashcards, image posts and videos next to text items', () => {
    const r = parseBulkFile(
      manifest([
        { q: 'क्या?', options: ['हाँ', 'नहीं'], answer: 'A', explanation: 'क्योंकि' },
        card(1),
        { kind: 'image', title: 'Notes pages', images: ['p1.jpg', 'p2.JPG'], caption: 'cap' },
        { kind: 'video', title: 'Reel one', file: 'reel-01.mp4', durationSeconds: 45 },
        { kind: 'video', title: 'Reel two', file: 'reel-02.mp4' },
        { kind: 'flashcard', title: 'Text card', body: { front: 'a', back: 'b' } },
      ]),
    );
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.index)).toEqual([0, 5]);
    expect(r.media.map((m) => [m.index, m.kind, m.refs.length])).toEqual([
      [1, 'flashcard', 2],
      [2, 'image', 2],
      [3, 'video', 1],
      [4, 'video', 1],
    ]);
    expect(r.media[2]!.durationMs).toBe(45_000);
    expect(r.media[3]!.durationMs).toBeUndefined();
  });

  it('reports readable problems for bad media entries', () => {
    const r = parseBulkFile(
      manifest([
        { kind: 'flashcard', title: 'No back', front: 'a.png', back: '' },
        { kind: 'flashcard', title: 'Gif card', front: 'a.gif', back: 'b.png' },
        { kind: 'image', title: 'No images', images: [] },
        {
          kind: 'image',
          title: 'Too many',
          images: Array.from({ length: 11 }, (_, i) => `${i}.jpg`),
        },
        { kind: 'video', title: 'Mov file', file: 'a.mov' },
        { kind: 'video', title: 'Bad length', file: 'a.mp4', durationSeconds: 5000 },
        { kind: 'video', title: 'No topic', file: 'a.mp4', topic: undefined },
        { kind: 'video', title: 'x', file: 'a.mp4' }, // title too short
      ]),
    );
    expect(r.media.map((m) => m.index)).toEqual([6]);
    expect(r.errors.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(r.errors[1]!.message).toMatch(/\.jpg, \.png or \.webp/);
    expect(r.errors[4]!.message).toMatch(/\.mp4/);
  });

  it('caps media manifests at 2000 items and 600 files', () => {
    const many = Array.from({ length: 2001 }, (_, i) => card(i));
    expect(parseBulkFile(manifest(many)).fatal).toBe('too_many_media_items');
    const pages = Array.from({ length: 61 }, (_, i) => ({
      kind: 'image',
      title: `Post ${i}`,
      images: Array.from({ length: 10 }, (_, j) => `${i}-${j}.jpg`),
    }));
    expect(parseBulkFile(manifest(pages)).fatal).toBe('too_many_files');
  });
});

describe('matching picked files', () => {
  const items = parseBulkFile(manifest([card(1), card(2)])).media;

  it('matches by base name, case-insensitively, ignoring folders', () => {
    expect(fileKey('Download/Cards\\CARD-001-Front.PNG')).toBe('card-001-front.png');
    const p = buildMediaPlan(
      parseBulkFile(manifest([{ ...card(1), front: 'cards/Card-1-FRONT.png' }])).media,
      [pic('card-1-front.png'), pic('CARD-1-back.PNG')],
    );
    expect(p.ready).toHaveLength(1);
    expect(p.ready[0]!.files.map((f) => f.name)).toEqual(['card-1-front.png', 'CARD-1-back.PNG']);
  });

  it('matches Hindi file names (Unicode normalisation) ', () => {
    const it = parseBulkFile(
      manifest([{ kind: 'image', title: 'हिंदी चित्र', images: ['चित्र-१.jpg'] }]),
    ).media;
    const p = buildMediaPlan(it, [pic('चित्र-१.JPG'.normalize('NFD'), 10, 'image/jpeg')]);
    expect(p.ready).toHaveLength(1);
  });

  it('lists missing, unused and duplicate files and skips affected items', () => {
    const p = buildMediaPlan(items, [
      pic('card-1-front.png'),
      pic('card-1-back.png'),
      pic('card-2-front.png'),
      pic('card-1-front.png'), // picked twice
      pic('stray.png'),
    ]);
    expect(p.ready.map((r) => r.index)).toEqual([0]);
    expect(p.missing).toEqual(['card-2-back.png']);
    expect(p.skipped).toEqual([
      { index: 1, message: 'file not found among the selected files: card-2-back.png' },
    ]);
    expect(p.unused).toEqual(['stray.png']);
    expect(p.duplicates).toEqual(['card-1-front.png']);
  });

  it('flags wrong types and sizes', () => {
    const vids = parseBulkFile(
      manifest([
        { kind: 'video', title: 'Big one', file: 'big.mp4' },
        { kind: 'video', title: 'Wrong type', file: 'odd.mp4' },
        { kind: 'video', title: 'Fine clip', file: 'ok.mp4' },
        { kind: 'image', title: 'Huge image', images: ['huge.png'] },
      ]),
    ).media;
    const p = buildMediaPlan(vids, [
      pic('big.mp4', MAX_VIDEO_BYTES + 1, 'video/mp4'),
      pic('odd.mp4', 5, 'video/quicktime'),
      pic('ok.mp4', MAX_VIDEO_BYTES, ''),
      pic('huge.png', MAX_IMAGE_BYTES + 1),
    ]);
    expect(p.ready.map((r) => r.index)).toEqual([2]);
    expect(p.ready[0]!.files[0]!.mimeType).toBe('video/mp4'); // taken from the extension
    expect(p.badFiles).toEqual([
      { name: 'big.mp4', reason: 'size' },
      { name: 'odd.mp4', reason: 'type' },
      { name: 'huge.png', reason: 'size' },
    ]);
    expect(uploadStats(p.ready)).toEqual({ files: 1, bytes: MAX_VIDEO_BYTES });
  });
});

describe('expansion', () => {
  it('every expanded payload passes the server validator', () => {
    const r = parseBulkFile(
      manifest([
        card(1),
        { ...card(2), frontText: 'सवाल?', backText: 'जवाब' },
        { kind: 'image', title: 'Pages', images: ['a.jpg', 'b.webp'], caption: 'cap' },
        { kind: 'video', title: 'Reel', file: 'r.mp4', durationSeconds: 12 },
        { kind: 'video', title: 'Reel measured', file: 'm.mp4' },
      ]),
    );
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `media-${i}`);
    const bodies = r.media.map((m) => expandMediaItem(m, ids(m.refs.length), 33_000));
    for (const b of bodies) expect(parseCreatorSubmission(b).ok).toBe(true);
    expect(bodies[0]!.body).toEqual({
      front: 'कार्ड 1',
      back: 'कार्ड 1',
      frontMediaId: 'media-0',
      backMediaId: 'media-1',
    });
    expect((bodies[1]!.body as { front: string }).front).toBe('सवाल?');
    expect(bodies[2]!.body).toEqual({ mediaIds: ['media-0', 'media-1'], caption: 'cap' });
    expect(bodies[3]!.body).toEqual({ mediaId: 'media-0', durationMs: 12_000 });
    expect(bodies[4]!.body).toEqual({ mediaId: 'media-0', durationMs: 33_000 });
  });
});

describe('runMixedImport', () => {
  const build = () => {
    const parsed = parseBulkFile(
      manifest([
        card(1),
        { q: 'क्या?', options: ['हाँ', 'नहीं'], answer: 'A', explanation: 'क्योंकि' },
        { kind: 'video', title: 'Reel', file: 'r.mp4' },
      ]),
    );
    const plan = buildMediaPlan(parsed.media, [
      pic('card-1-front.png'),
      pic('card-1-back.png'),
      pic('r.mp4', 100, 'video/mp4'),
    ]);
    return [...parsed.items, ...plan.ready].sort((a, b) => a.index - b.index) as ImportEntry[];
  };
  const okSend = async (p: unknown[]) => ({ results: p.map(() => ({ ok: true, contentId: 'c' })) });
  const noSleep = async () => {};

  it('uploads files one by one and sends bodies with the real media ids', async () => {
    const sent: unknown[][] = [];
    const uploads: string[] = [];
    const progress: (number | undefined)[] = [];
    const s = await runMixedImport(
      build(),
      async (p) => {
        sent.push(p);
        return okSend(p);
      },
      async (f, kind) => {
        uploads.push(f.name);
        return {
          mediaId: `id-${uploads.length}`,
          durationMs: kind === 'video' ? 20_000 : undefined,
        };
      },
      { onProgress: (p) => progress.push(p.files?.done), sleep: noSleep },
    );
    expect(s).toMatchObject({ imported: 3, notSent: 0 });
    expect(uploads).toEqual(['card-1-front.png', 'card-1-back.png', 'r.mp4']);
    const bodies = sent.flat() as { body: Record<string, unknown> }[];
    expect(bodies[0]!.body).toMatchObject({ frontMediaId: 'id-1', backMediaId: 'id-2' });
    expect(bodies[2]!.body).toEqual({ mediaId: 'id-3', durationMs: 20_000 });
    expect(Math.max(...progress.filter((x): x is number => x !== undefined))).toBe(3);
    for (const b of bodies) expect(parseCreatorSubmission(b).ok).toBe(true);
  });

  it('retries network errors twice, then stops as offline resuming at that item', async () => {
    let calls = 0;
    const s = await runMixedImport(
      build(),
      okSend,
      async () => {
        calls++;
        throw Object.assign(new Error('net'), { status: 0 });
      },
      { sleep: noSleep },
    );
    expect(calls).toBe(3);
    expect(s).toMatchObject({ stopped: 'offline', resumeAt: 1, imported: 0, notSent: 3 });
  });

  it('a 429 on upload stops as rate_limited after sending what was prepared', async () => {
    let n = 0;
    const sent: unknown[][] = [];
    const entries = build();
    // reorder so the text item comes first
    entries.sort((a, b) => (a.index === 1 ? -1 : b.index === 1 ? 1 : a.index - b.index));
    const s = await runMixedImport(
      entries,
      async (p) => {
        sent.push(p);
        return okSend(p);
      },
      async () => {
        n++;
        throw Object.assign(new Error('rl'), { status: 429 });
      },
      { sleep: noSleep },
    );
    expect(n).toBe(1);
    expect(sent.flat()).toHaveLength(1);
    expect(s).toMatchObject({ stopped: 'rate_limited', imported: 1, notSent: 2 });
  });

  it('a 4xx upload failure fails only that item; cancel stops cleanly', async () => {
    const s = await runMixedImport(
      build(),
      okSend,
      async (f) => {
        if (f.name === 'r.mp4') throw Object.assign(new Error('big'), { status: 413 });
        return { mediaId: 'x' };
      },
      { sleep: noSleep },
    );
    expect(s.imported).toBe(2);
    expect(s.failed).toEqual([{ index: 2, message: expect.stringMatching(/r\.mp4/) }]);

    let calls = 0;
    const c = await runMixedImport(build(), okSend, async () => ({ mediaId: `m${++calls}` }), {
      isCancelled: () => calls >= 1,
      sleep: noSleep,
    });
    expect(c.stopped).toBe('cancelled');
    expect(c.resumeAt).toBe(1);
  });
});

describe('bulk-upload/*.json owner templates', () => {
  const dir = new URL('../../../../bulk-upload/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  it('finds the template files', () => expect(files.length).toBeGreaterThanOrEqual(3));
  for (const f of files)
    it(`${f} parses with the real parser and all referenced media can be matched`, () => {
      const r = parseBulkFile(readFileSync(new URL(f, dir), 'utf8'));
      expect(r.fatal).toBeUndefined();
      expect(r.errors).toEqual([]);
      const present = r.media.flatMap((m) =>
        m.refs.map((x) => pic(x.name, 1000, x.kind === 'video' ? 'video/mp4' : 'image/png')),
      );
      const plan = buildMediaPlan(r.media, present);
      expect(plan.skipped).toEqual([]);
      expect(plan.ready).toHaveLength(r.media.length);
      for (const m of plan.ready)
        expect(
          parseCreatorSubmission(
            expandMediaItem(
              m,
              m.refs.map((_, i) => `id-${i}`),
            ),
          ).ok,
        ).toBe(true);
    });
});
