import { describe, expect, it } from 'vitest';
import {
  questionBody,
  noteBody,
  interactiveDefinition,
  gradeAnswer,
  toClientQuestion,
  contentEnvelope,
  type QuestionBody,
} from './index.ts';

const base = { prompt: 'Q?', explanation: 'Because.' };
const parse = (q: unknown) => questionBody.safeParse(q);

describe('question schema', () => {
  const sc = {
    ...base,
    type: 'single_choice',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: { optionId: 'a' },
  };
  it('accepts valid single choice', () => expect(parse(sc).success).toBe(true));
  it('rejects answer referencing unknown option', () =>
    expect(parse({ ...sc, answer: { optionId: 'z' } }).success).toBe(false));
  it('rejects duplicate option ids', () =>
    expect(
      parse({
        ...sc,
        options: [
          { id: 'a', text: 'A' },
          { id: 'a', text: 'B' },
        ],
      }).success,
    ).toBe(false));
  it('rejects missing explanation', () =>
    expect(parse({ ...sc, explanation: '' }).success).toBe(false));
  it('rejects multi-choice where every option is correct (ambiguous)', () => {
    const opts = ['a', 'b', 'c'].map((id) => ({ id, text: id }));
    expect(
      parse({
        ...base,
        type: 'multi_choice',
        options: opts,
        answer: { optionIds: ['a', 'b', 'c'] },
      }).success,
    ).toBe(false);
  });
  it('requires ordering answer to be a permutation', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, text: id }));
    expect(
      parse({ ...base, type: 'ordering', items, answer: { order: ['a', 'b', 'c'] } }).success,
    ).toBe(true);
    expect(
      parse({ ...base, type: 'ordering', items, answer: { order: ['a', 'b', 'x'] } }).success,
    ).toBe(false);
    expect(parse({ ...base, type: 'ordering', items, answer: { order: ['a', 'b'] } }).success).toBe(
      false,
    );
  });
  it('rejects unknown question types', () =>
    expect(parse({ ...base, type: 'essay' }).success).toBe(false));
});

describe('grading', () => {
  const mk = (q: unknown) => questionBody.parse(q) as QuestionBody;
  it('single choice', () => {
    const q = mk({
      ...base,
      type: 'single_choice',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      answer: { optionId: 'b' },
    });
    expect(gradeAnswer(q, { optionId: 'b' }).correct).toBe(true);
    expect(gradeAnswer(q, { optionId: 'a' }).correct).toBe(false);
    expect(gradeAnswer(q, null).correct).toBe(false);
  });
  it('multi choice gives partial credit but is only correct when exact', () => {
    const opts = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id }));
    const q = mk({
      ...base,
      type: 'multi_choice',
      options: opts,
      answer: { optionIds: ['a', 'b'] },
    });
    expect(gradeAnswer(q, { optionIds: ['b', 'a'] }).correct).toBe(true);
    const part = gradeAnswer(q, { optionIds: ['a'] });
    expect(part.correct).toBe(false);
    expect(part.score).toBeCloseTo(0.5);
    expect(gradeAnswer(q, { optionIds: ['a', 'c'] }).score).toBe(0);
  });
  it('fill blank is whitespace/case-insensitive by default', () => {
    const q = mk({ ...base, type: 'fill_blank', answer: { accepted: ['New Delhi', 'Delhi'] } });
    expect(gradeAnswer(q, { value: '  new   delhi ' }).correct).toBe(true);
    expect(gradeAnswer(q, { value: 'Mumbai' }).correct).toBe(false);
  });
  it('numerical honours tolerance and rejects NaN/strings', () => {
    const q = mk({ ...base, type: 'numerical', answer: { value: 3.14, tolerance: 0.01 } });
    expect(gradeAnswer(q, { value: 3.145 }).correct).toBe(true);
    expect(gradeAnswer(q, { value: 3.2 }).correct).toBe(false);
    expect(gradeAnswer(q, { value: NaN }).correct).toBe(false);
    expect(gradeAnswer(q, { value: '3.14' }).correct).toBe(false);
  });
  it('ordering and matching', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, text: id }));
    const o = mk({ ...base, type: 'ordering', items, answer: { order: ['c', 'a', 'b'] } });
    expect(gradeAnswer(o, { order: ['c', 'a', 'b'] }).correct).toBe(true);
    expect(gradeAnswer(o, { order: ['a', 'b', 'c'] }).correct).toBe(false);
    const m = mk({
      ...base,
      type: 'matching',
      left: [
        { id: 'l1', text: 'x' },
        { id: 'l2', text: 'y' },
      ],
      right: [
        { id: 'r1', text: 'p' },
        { id: 'r2', text: 'q' },
      ],
      answer: {
        pairs: [
          { left: 'l1', right: 'r1' },
          { left: 'l2', right: 'r2' },
        ],
      },
    });
    expect(
      gradeAnswer(m, {
        pairs: [
          { left: 'l1', right: 'r1' },
          { left: 'l2', right: 'r2' },
        ],
      }).correct,
    ).toBe(true);
    expect(gradeAnswer(m, { pairs: [{ left: 'l1', right: 'r1' }] }).correct).toBe(false);
  });
});

describe('answer leakage', () => {
  it('toClientQuestion strips answer and explanation and does not leak ordering via position', () => {
    const items = ['c', 'a', 'b'].map((id) => ({ id, text: id }));
    const q = questionBody.parse({
      ...base,
      type: 'ordering',
      items,
      answer: { order: ['a', 'b', 'c'] },
    });
    const c = toClientQuestion(q);
    expect(JSON.stringify(c)).not.toContain('explanation');
    expect(c).not.toHaveProperty('answer');
    expect((c.items as { id: string }[]).map((i) => i.id)).not.toEqual(['a', 'b', 'c']);
  });
});

describe('notes & interactive', () => {
  it('note blocks are structured, not raw HTML', () => {
    expect(
      noteBody.safeParse({
        blocks: [
          { type: 'heading', level: 1, text: 'Hi' },
          { type: 'paragraph', text: 'x' },
        ],
      }).success,
    ).toBe(true);
    expect(noteBody.safeParse({ blocks: [{ type: 'html', html: '<script>' }] }).success).toBe(
      false,
    );
    expect(noteBody.safeParse({ blocks: [] }).success).toBe(false);
  });
  it('map region paths must be SVG path data', () => {
    const d = (path: string) => ({
      kind: 'map',
      viewBox: [0, 0, 100, 100],
      regions: [{ id: 'r', name: 'R', path }],
    });
    expect(interactiveDefinition.safeParse(d('M0 0 L10 0 L10 10 Z')).success).toBe(true);
    expect(interactiveDefinition.safeParse(d('javascript:alert(1)')).success).toBe(false);
  });
  it('envelope requires language and structural ownership dimensions', () => {
    const ok = contentEnvelope.safeParse({
      type: 'note',
      title: 'T',
      language: 'hi',
      ownership: 'official',
      sourceType: 'imported',
    });
    expect(ok.success).toBe(true);
    expect(
      contentEnvelope.safeParse({
        type: 'note',
        title: 'T',
        language: 'English',
        ownership: 'official',
        sourceType: 'imported',
      }).success,
    ).toBe(false);
  });
});
