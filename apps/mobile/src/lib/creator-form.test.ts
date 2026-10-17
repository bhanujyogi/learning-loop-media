import { parseCreatorSubmission } from '@learning-loop/validation';
import { describe, expect, it } from 'vitest';
import {
  buildSubmission,
  emptyForm,
  noteBlocks,
  postStatus,
  type CreatorForm,
} from './creator-form';

const CONCEPT = '50000000-0000-0000-0000-000000000004';
const base = (over: Partial<CreatorForm>): CreatorForm => ({
  ...emptyForm('en'),
  title: 'A decent title',
  topic: 'Ohm’s law',
  confirmed: true,
  ...over,
});
const accepted = (f: CreatorForm) => {
  const r = buildSubmission(f);
  if (!r.ok) throw new Error('form rejected: ' + r.errors.join(','));
  return parseCreatorSubmission(r.payload);
};

describe('creator form → submission (every valid form must pass the SERVER validator)', () => {
  it('notes: paragraphs, headings and Hindi text', () => {
    expect(accepted(base({ noteText: '# Ohm\n\nV = I x R\n\nSecond paragraph' })).ok).toBe(true);
    expect(accepted(base({ language: 'hi', noteText: 'ओम का नियम: V = IR' })).ok).toBe(true);
    expect(noteBlocks('# Title\n\nText\n\n\n\nMore')).toEqual([
      { type: 'heading', level: 2, text: 'Title' },
      { type: 'paragraph', text: 'Text' },
      { type: 'paragraph', text: 'More' },
    ]);
  });
  it('flashcards', () => {
    expect(accepted(base({ kind: 'flashcard', front: 'SI = ?', back: 'PRT/100' })).ok).toBe(true);
  });
  it('multiple choice: blank options are dropped and the correct index follows the kept options', () => {
    const f = base({
      kind: 'question',
      prompt: 'Unit?',
      options: ['Volt', '', 'Ohm', 'Watt'],
      correct: 2,
      explanation: 'Ohm.',
    });
    const r = buildSubmission(f);
    if (!r.ok) throw new Error('rejected');
    expect(r.payload.body).toMatchObject({
      options: [
        { id: 'a', text: 'Volt' },
        { id: 'b', text: 'Ohm' },
        { id: 'c', text: 'Watt' },
      ],
    });
    expect(r.payload.answer).toEqual({ optionId: 'b' });
    expect(parseCreatorSubmission(r.payload).ok).toBe(true);
  });
  it('true/false, fill-in-the-blank and numerical', () => {
    const q = { kind: 'question' as const, prompt: 'Statement?', explanation: 'Because.' };
    expect(accepted(base({ ...q, qType: 'true_false', tf: false })).ok).toBe(true);
    expect(accepted(base({ ...q, qType: 'fill_blank', accepted: 'Jaipur, jaipur ,' })).ok).toBe(
      true,
    );
    expect(accepted(base({ ...q, qType: 'numerical', numValue: '10', tolerance: '0.5' })).ok).toBe(
      true,
    );
    expect(accepted(base({ ...q, qType: 'numerical', numValue: '-3' })).ok).toBe(true);
  });
});

describe('what is reported missing', () => {
  it('lists every missing piece so the form can highlight them', () => {
    const r = buildSubmission(emptyForm('en'));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok)
      expect(r.errors).toEqual(expect.arrayContaining(['title', 'topic', 'confirm', 'noteText']));
  });
  it('cannot post without confirming rights, a topic or a correct option', () => {
    const noConfirm = buildSubmission(base({ noteText: 'x', confirmed: false }));
    expect(noConfirm.ok === false && noConfirm.errors).toContain('confirm');
    const noTopic = buildSubmission(base({ noteText: 'x', topic: '  ' }));
    expect(noTopic.ok === false && noTopic.errors).toContain('topic');
    const shortTopic = buildSubmission(base({ noteText: 'x', topic: 'a' }));
    expect(shortTopic.ok === false && shortTopic.errors).toContain('topic');
    const longTopic = buildSubmission(base({ noteText: 'x', topic: 'a'.repeat(81) }));
    expect(longTopic.ok === false && longTopic.errors).toContain('topic');
    const mc = buildSubmission(
      base({ kind: 'question', prompt: 'p', explanation: 'e', options: ['a', 'b'], correct: null }),
    );
    expect(mc.ok === false && mc.errors).toEqual(['correct']);
    const blankCorrect = buildSubmission(
      base({
        kind: 'question',
        prompt: 'p',
        explanation: 'e',
        options: ['a', '  ', 'c'],
        correct: 1,
      }),
    );
    expect(blankCorrect.ok === false && blankCorrect.errors).toContain('correct'); // the marked option is empty
  });
  it('rejects bad numbers and requires an explanation', () => {
    const q = {
      kind: 'question' as const,
      prompt: 'p',
      qType: 'numerical' as const,
      explanation: 'e',
    };
    for (const v of ['', 'abc', 'Infinity']) {
      const r = buildSubmission(base({ ...q, numValue: v }));
      expect(r.ok === false && r.errors, v).toContain('num');
    }
    const neg = buildSubmission(base({ ...q, numValue: '1', tolerance: '-1' }));
    expect(neg.ok === false && neg.errors).toContain('num');
    const noExp = buildSubmission(base({ ...q, numValue: '1', explanation: ' ' }));
    expect(noExp.ok === false && noExp.errors).toContain('explanation');
  });
});

describe('video posts', () => {
  const MEDIA = '60000000-0000-4000-8000-000000000001';
  const clip = { uri: 'file:///c/a.mp4', name: 'a.mp4', size: 3_000_000, mimeType: 'video/mp4' };
  it('needs a chosen mp4 within the size limit', () => {
    const none = buildSubmission(base({ kind: 'video' }));
    expect(none.ok === false && none.errors).toContain('video');
    const wrongType = buildSubmission(
      base({ kind: 'video', video: { ...clip, mimeType: 'video/quicktime' } }),
    );
    expect(wrongType.ok === false && wrongType.errors).toContain('videoType');
    const big = buildSubmission(base({ kind: 'video', video: { ...clip, size: 61 * 1048576 } }));
    expect(big.ok === false && big.errors).toContain('videoSize');
  });
  it('completed with the uploaded media id, it passes the SERVER validator', () => {
    const r = buildSubmission(base({ kind: 'video', video: clip }));
    if (!r.ok) throw new Error('rejected');
    const v = parseCreatorSubmission({
      ...r.payload,
      body: { mediaId: MEDIA, durationMs: 45_000 },
    });
    expect(v.ok && v.value.mediaIds?.[0]).toBe(MEDIA);
  });
});

describe('topic', () => {
  it('free text alone is enough; a picked concept is sent in addition', () => {
    const free = buildSubmission(base({ noteText: 'x', topic: '  Kirchhoff laws ' }));
    if (!free.ok) throw new Error('rejected');
    expect(free.payload).toMatchObject({ topic: 'Kirchhoff laws' });
    expect(free.payload).not.toHaveProperty('conceptId');
    expect(parseCreatorSubmission(free.payload).ok).toBe(true);

    const picked = buildSubmission(base({ noteText: 'x', conceptId: CONCEPT }));
    if (!picked.ok) throw new Error('rejected');
    expect(picked.payload).toMatchObject({ topic: 'Ohm’s law', conceptId: CONCEPT });
    const v = parseCreatorSubmission(picked.payload);
    expect(v.ok && v.value.conceptId).toBe(CONCEPT);
  });
  it('Hindi topics pass the server validator', () => {
    expect(accepted(base({ language: 'hi', topic: 'ओम का नियम', noteText: 'V = IR' })).ok).toBe(true);
  });
});

describe('image posts', () => {
  const M1 = '70000000-0000-4000-8000-000000000001';
  const M2 = '70000000-0000-4000-8000-000000000002';
  const pic = (n: number) => ({
    uri: `file:///c/${n}.jpg`,
    name: `${n}.jpg`,
    size: 400_000,
    mimeType: 'image/jpeg',
  });
  it('needs 1 to 10 usable images', () => {
    const none = buildSubmission(base({ kind: 'image' }));
    expect(none.ok === false && none.errors).toContain('images');
    const eleven = buildSubmission(
      base({ kind: 'image', images: Array.from({ length: 11 }, (_, i) => pic(i)) }),
    );
    expect(eleven.ok === false && eleven.errors).toContain('images');
    const gif = buildSubmission(
      base({ kind: 'image', images: [{ ...pic(1), mimeType: 'image/gif' }] }),
    );
    expect(gif.ok === false && gif.errors).toContain('imageType');
    const huge = buildSubmission(
      base({ kind: 'image', images: [{ ...pic(1), size: 11 * 1048576 }] }),
    );
    expect(huge.ok === false && huge.errors).toContain('imageSize');
  });
  it('completed with the uploaded media ids (and caption) it passes the SERVER validator', () => {
    const r = buildSubmission(
      base({ kind: 'image', images: [pic(1), pic(2)], caption: '  Circuit diagram  ' }),
    );
    if (!r.ok) throw new Error('rejected');
    expect(r.payload.body).toEqual({ caption: 'Circuit diagram' });
    const v = parseCreatorSubmission({
      ...r.payload,
      body: { ...(r.payload.body as object), mediaIds: [M1, M2] },
    });
    expect(v.ok && v.value.mediaIds).toEqual([M1, M2]);
    expect(v.ok && v.value.body).toMatchObject({ caption: 'Circuit diagram' });
  });
  it('the caption is optional', () => {
    const r = buildSubmission(base({ kind: 'image', images: [pic(1)] }));
    if (!r.ok) throw new Error('rejected');
    expect(parseCreatorSubmission({ ...r.payload, body: { mediaIds: [M1] } }).ok).toBe(true);
  });
});

describe('post status shown to the creator', () => {
  it('maps publishing + moderation to what the creator should be told', () => {
    expect(postStatus({ publishing: 'published', moderation: 'pending_review' })).toBe('pending');
    expect(postStatus({ publishing: 'published', moderation: 'cleared' })).toBe('live');
    expect(postStatus({ publishing: 'published', moderation: 'removed' })).toBe('removed');
    expect(postStatus({ publishing: 'published', moderation: 'flagged' })).toBe('hidden');
    expect(postStatus({ publishing: 'deleted', moderation: 'cleared' })).toBe('hidden');
  });
});
