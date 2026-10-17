import { parseCreatorSubmission } from '@learning-loop/validation';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BULK_CHUNK,
  chunk,
  cleanJsonText,
  MAX_BULK_ITEMS,
  parseBulkFile,
  resolveShorthandAnswer,
  runBulkImport,
  utf8Bytes,
  type ValidItem,
} from './bulk-import';

const file = (o: unknown) => JSON.stringify(o);
const hiMcq = {
  q: 'भारत की राजधानी क्या है?',
  options: ['मुंबई', 'नई दिल्ली', 'कोलकाता', 'चेन्नई'],
  answer: 'B',
  explanation: 'नई दिल्ली भारत की राजधानी है।',
};
const enMcq = {
  q: 'Which unit measures electrical resistance?',
  options: ['Volt', 'Ohm', 'Watt', 'Ampere'],
  answer: 'Ohm',
  explanation: 'Resistance is measured in ohms.',
};

describe('parseBulkFile', () => {
  it('expands shorthand MCQs (Hindi + English) into submissions the SERVER validator accepts', () => {
    const r = parseBulkFile(
      file({ version: 1, language: 'hi', topic: 'सामान्य ज्ञान', items: [hiMcq, enMcq] }),
    );
    expect(r.errors).toEqual([]);
    expect(r.total).toBe(2);
    expect(r.items).toHaveLength(2);
    const [a, b] = r.items;
    expect(a!.payload).toMatchObject({
      kind: 'question',
      language: 'hi',
      topic: 'सामान्य ज्ञान',
      difficulty: 'medium',
      answer: { optionId: 'b' },
      body: { type: 'single_choice', prompt: hiMcq.q },
    });
    expect(b!.payload.answer).toEqual({ optionId: 'b' }); // matched by option text
    for (const i of r.items) expect(parseCreatorSubmission(i.payload).ok).toBe(true);
  });

  it('title is the first 80 characters of the question', () => {
    const long = 'Q'.repeat(200);
    const r = parseBulkFile(file({ language: 'en', topic: 'T1', items: [{ ...enMcq, q: long }] }));
    expect((r.items[0]!.payload.title as string).length).toBe(80);
  });

  it('accepts full-form items of every supported kind', () => {
    const items = [
      {
        kind: 'question',
        title: 'True or false?',
        body: { type: 'true_false', prompt: 'The sun is a star.' },
        answer: { value: true },
        explanation: 'It is.',
      },
      {
        kind: 'question',
        title: 'Capital of Rajasthan',
        language: 'hi',
        body: { type: 'fill_blank', prompt: 'राजस्थान की राजधानी ______ है।' },
        answer: { accepted: ['जयपुर', 'Jaipur'] },
        explanation: 'जयपुर।',
      },
      {
        kind: 'question',
        title: 'Numerical',
        difficulty: 'hard',
        body: { type: 'numerical', prompt: '2 + 2.5 = ?' },
        answer: { value: 4.5, tolerance: 0 },
        explanation: 'Add them.',
      },
      {
        kind: 'question',
        title: 'Full single choice',
        body: {
          type: 'single_choice',
          prompt: 'Pick b',
          options: [
            { id: 'a', text: 'one' },
            { id: 'b', text: 'two' },
          ],
        },
        answer: { optionId: 'b' },
        explanation: 'Because.',
      },
      { kind: 'flashcard', title: 'Simple interest', body: { front: 'SI = ?', back: 'PRT/100' } },
      {
        kind: 'note',
        title: 'Ohm law',
        body: {
          blocks: [
            { type: 'heading', level: 2, text: 'Ohm' },
            { type: 'paragraph', text: 'V = IR' },
            { type: 'revision_prompt', prompt: 'State the law.' },
          ],
        },
      },
    ];
    const r = parseBulkFile(file({ version: 1, language: 'en', topic: 'Physics', items }));
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(6);
    expect(r.items[1]!.payload.language).toBe('hi'); // item language wins over the file default
    expect(r.items[0]!.payload.language).toBe('en');
  });

  it('reports each bad item by position and keeps the good ones', () => {
    const r = parseBulkFile(
      file({
        language: 'en',
        topic: 'Physics',
        items: [
          enMcq,
          { ...enMcq, answer: 'Newton' }, // matches nothing
          { q: 'No options?', answer: 'A' },
          { kind: 'flashcard', title: 'Missing back', body: { front: 'x' } },
          { kind: 'video', title: 'Nope', body: {} },
          'not an object',
          { ...enMcq, explanation: '' }, // explanation required
          { ...enMcq, topic: 'x' }, // topic too short
        ],
      }),
    );
    expect(r.total).toBe(8);
    expect(r.items.map((i) => i.index)).toEqual([0]);
    expect(r.errors.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.errors[0]!.message).toMatch(/does not match any option/);
    expect(r.errors[3]!.message).toMatch(/cannot be imported/);
  });

  it('needs a language and a topic from the item or the file', () => {
    const r = parseBulkFile(file({ items: [enMcq, { ...enMcq, language: 'en', topic: 'Ohm' }] }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toMatch(/language/);
    expect(r.items).toHaveLength(1);
  });

  it('tolerates a BOM, ```json fences and a bare list', () => {
    const body = file({ version: 1, language: 'en', topic: 'Physics', items: [enMcq] });
    for (const t of [
      '\uFEFF' + body,
      '```json\n' + body + '\n```',
      'Here you go:\n```\n' + body + '\n```\nDone',
    ]) {
      const r = parseBulkFile(t);
      expect(r.fatal, t.slice(0, 12)).toBeUndefined();
      expect(r.items).toHaveLength(1);
    }
    const bare = parseBulkFile(file([{ ...enMcq, language: 'en', topic: 'Ohm' }]));
    expect(bare.items).toHaveLength(1);
    expect(cleanJsonText('\uFEFF  {"a":1} ')).toBe('{"a":1}');
  });

  it('rejects unusable files as a whole', () => {
    expect(parseBulkFile('').fatal).toBe('empty');
    expect(parseBulkFile('hello').fatal).toBe('not_json');
    expect(parseBulkFile('{"items": 3}').fatal).toBe('no_items');
    expect(parseBulkFile('{"items": []}').fatal).toBe('no_items');
    expect(parseBulkFile('{"version": 2, "items": [{}]}').fatal).toBe('bad_version');
    const many = file({
      language: 'en',
      topic: 'T1',
      items: Array(MAX_BULK_ITEMS + 1).fill(enMcq),
    });
    expect(parseBulkFile(many).fatal).toBe('too_many');
    expect(parseBulkFile('x'.repeat(5 * 1024 * 1024 + 1)).fatal).toBe('too_big');
  });

  it('counts bytes, not characters (Hindi is 3 bytes per letter)', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('नई')).toBe(6);
    expect(utf8Bytes('😀')).toBe(4);
    expect(parseBulkFile('न'.repeat(1_800_000)).fatal).toBe('too_big'); // 5.4 MB
  });
});

describe('content/bulk-template.json', () => {
  it('is a valid file: all 6 example items pass the server validator', () => {
    const text = readFileSync(
      new URL('../../../../content/bulk-template.json', import.meta.url),
      'utf8',
    );
    const r = parseBulkFile(text);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(6);
    expect(r.items.map((i) => i.payload.kind)).toEqual([
      'question',
      'question',
      'question',
      'question',
      'flashcard',
      'note',
    ]);
  });
});

describe('shorthand answers', () => {
  const o = ['red', 'green', 'blue', 'B'];
  it('accepts a letter, the option text or a 1-based number', () => {
    expect(resolveShorthandAnswer('c', o)).toEqual({ ok: true, index: 2 });
    expect(resolveShorthandAnswer('(C)', o)).toEqual({ ok: true, index: 2 });
    expect(resolveShorthandAnswer('C)', o)).toEqual({ ok: true, index: 2 });
    expect(resolveShorthandAnswer(' Green ', o)).toEqual({ ok: true, index: 1 });
    expect(resolveShorthandAnswer(2, o)).toEqual({ ok: true, index: 1 });
    expect(resolveShorthandAnswer('3', o)).toEqual({ ok: true, index: 2 });
  });
  it('rejects anything ambiguous or out of range', () => {
    expect(resolveShorthandAnswer(0, o).ok).toBe(false);
    expect(resolveShorthandAnswer(5, o).ok).toBe(false);
    expect(resolveShorthandAnswer('E', o).ok).toBe(false);
    expect(resolveShorthandAnswer('', o).ok).toBe(false);
    expect(resolveShorthandAnswer(1.5, o).ok).toBe(false);
  });
});

describe('chunk', () => {
  it('splits into pieces of 25', () => {
    const parts = chunk(Array.from({ length: 60 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([25, 25, 10]);
    expect(BULK_CHUNK).toBe(25);
    expect(chunk([], 25)).toEqual([]);
  });
});

describe('runBulkImport', () => {
  const mk = (n: number): ValidItem[] =>
    Array.from({ length: n }, (_, i) => ({ index: i, payload: { n: i } }));
  const okAll = async (p: unknown[]) => ({ results: p.map(() => ({ ok: true, contentId: 'x' })) });
  const fast = { sleep: async () => {}, backoffMs: 0 };

  it('imports everything in chunks and reports progress', async () => {
    const sizes: number[] = [];
    const seen: number[] = [];
    const s = await runBulkImport(
      mk(60),
      async (p) => {
        sizes.push(p.length);
        return okAll(p);
      },
      { ...fast, onProgress: (p) => seen.push(p.done) },
    );
    expect(sizes).toEqual([25, 25, 10]);
    expect(s).toMatchObject({ imported: 60, notSent: 0, failed: [] });
    expect(s.stopped).toBeUndefined();
    expect(seen).toEqual([0, 25, 50, 60]);
  });

  it('records per-row failures without stopping', async () => {
    const s = await runBulkImport(
      mk(4),
      async (p) => ({
        results: p.map((_, i) =>
          i === 1 ? { ok: false, error: 'invalid_question' } : { ok: true },
        ),
      }),
      fast,
    );
    expect(s.imported).toBe(3);
    expect(s.failed).toEqual([{ index: 1, message: 'invalid_question' }]);
  });

  it('retries a network failure twice, then succeeds or stops', async () => {
    let calls = 0;
    const flaky = await runBulkImport(
      mk(3),
      async (p) => {
        if (++calls < 3) throw { status: 0 };
        return okAll(p);
      },
      fast,
    );
    expect(calls).toBe(3);
    expect(flaky.imported).toBe(3);

    calls = 0;
    const down = await runBulkImport(
      mk(30),
      async () => {
        calls++;
        throw { status: 0 };
      },
      fast,
    );
    expect(calls).toBe(3); // 1 try + 2 retries
    expect(down).toMatchObject({ stopped: 'offline', imported: 0, notSent: 30, resumeAt: 1 });
  });

  it('stops at once on a rate limit (HTTP 429) and says where to continue', async () => {
    let calls = 0;
    const s = await runBulkImport(
      mk(60),
      async (p) => {
        if (++calls === 2) throw { status: 429 };
        return okAll(p);
      },
      fast,
    );
    expect(calls).toBe(2); // no retries on 429
    expect(s).toMatchObject({ stopped: 'rate_limited', imported: 25, notSent: 35, resumeAt: 26 });
  });

  it('handles the server stopping part-way through a chunk (rate_limited row)', async () => {
    const s = await runBulkImport(
      mk(10),
      async () => ({
        results: [{ ok: true }, { ok: true }, { ok: true }, { ok: false, error: 'rate_limited' }],
      }),
      fast,
    );
    expect(s).toMatchObject({ stopped: 'rate_limited', imported: 3, notSent: 7, resumeAt: 4 });
    expect(s.failed).toEqual([]);
  });

  it('does not retry a rejected request (4xx) and can be cancelled between chunks', async () => {
    let calls = 0;
    const rejected = await runBulkImport(
      mk(5),
      async () => {
        calls++;
        throw { status: 403 };
      },
      fast,
    );
    expect(calls).toBe(1);
    expect(rejected.stopped).toBe('rejected');

    let cancel = false;
    const c = await runBulkImport(
      mk(60),
      async (p) => {
        cancel = true;
        return okAll(p);
      },
      { ...fast, isCancelled: () => cancel },
    );
    expect(c).toMatchObject({ stopped: 'cancelled', imported: 25, notSent: 35, resumeAt: 26 });
  });
});
