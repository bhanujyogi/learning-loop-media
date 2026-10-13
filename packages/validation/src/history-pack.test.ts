import { describe, expect, it } from 'vitest';
import {
  buildPack,
  curriculumSql,
  IDS,
  questionSubmission,
} from '../../../scripts/lib/history-pack.mjs';
import { parseCreatorSubmission } from './creator.ts';

// Synthetic rows in the pilot's file format (the real pilot content is deliberately NOT in this repository).
const row = (lang: 'en' | 'hi', over: object = {}) => ({
  object_id: `Q-T.${lang}`,
  language: lang,
  concept: 'Order of rulers',
  difficulty: { level: 2, label: 'basic' },
  payload: {
    question_type: 'single_choice',
    stem: lang === 'en' ? 'Which came first?' : 'पहले कौन आया?',
    options: ['A', 'B', 'C', 'D'].map((key, i) => ({ key, text: `opt ${i}` })),
    correct: ['C'],
    explanation: lang === 'en' ? 'Because.' : 'क्योंकि।',
  },
  ...over,
});
const unit = {
  concept: { en: 'Overview', hi: 'अवलोकन' },
  difficulty: { level: 2 },
  definition: { en: 'A definition.', hi: 'एक परिभाषा।' },
  key_facts: [{ en: 'Fact one.', hi: 'तथ्य एक।' }],
};

describe('history pack converter', () => {
  it('maps option letters to ids and the correct key to the right option; keeps Hindi intact', () => {
    const q = questionSubmission(row('hi')) as {
      answer: { optionId: string };
      body: { options: { id: string }[] };
      language: string;
    };
    expect(q.answer).toEqual({ optionId: 'c' });
    expect(q.body.options.map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(q.language).toBe('hi');
  });
  it('every converted item passes the SAME validator the server applies', () => {
    const pack = buildPack({ questions: [row('en'), row('hi')], units: [unit] });
    expect(pack.count).toBe(4);
    for (const it of pack.items)
      expect(parseCreatorSubmission(it).ok, JSON.stringify(it).slice(0, 80)).toBe(true);
  });
  it('refuses what it cannot convert faithfully instead of guessing', () => {
    expect(() => questionSubmission(row('en', { concept: 'Unmapped concept' }))).toThrow(
      /no concept mapping/,
    );
    expect(() => questionSubmission(row('en', { language: 'fr' }))).toThrow(/language/);
    const multi = row('en');
    multi.payload.correct = ['A', 'B'];
    expect(() => questionSubmission(multi)).toThrow(/single-choice/);
    const missing = row('en');
    missing.payload.correct = ['Z'];
    expect(() => questionSubmission(missing)).toThrow(/correct key/);
  });
  it('the curriculum SQL is idempotent and creates the concepts the pack refers to', () => {
    const sql = curriculumSql();
    expect(sql.match(/on conflict \(id\) do nothing/g)).toHaveLength(4);
    for (const id of Object.values(IDS)) expect(sql).toContain(id);
    expect(sql).not.toMatch(/delete|drop|truncate|update /i);
  });
});
