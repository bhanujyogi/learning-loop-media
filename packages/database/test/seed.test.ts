import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentEnvelope,
  interactiveDefinition,
  noteBody,
  flashcardBody,
  questionBody,
  gradeAnswer,
  toClientQuestion,
} from '@learning-loop/validation';
import { freshDb } from './harness';

describe('dev seed', () => {
  it('loads cleanly and every seeded body validates against the shared content schemas', async () => {
    const db = await freshDb();
    await db.exec(readFileSync(join(__dirname, '../../../supabase/seed/seed.sql'), 'utf8'));
    const rows = (
      await db.query<{
        type: string;
        body: Record<string, unknown>;
        answer: Record<string, unknown> | null;
        explanation: string | null;
      }>(
        `select c.type, v.body, k.answer, k.explanation from content_items c join content_versions v on v.id = c.current_version_id left join content_answer_keys k on k.content_version_id = v.id`,
      )
    ).rows;
    expect(rows.length).toBe(6);
    for (const r of rows) {
      if (r.type === 'note') expect(noteBody.safeParse(r.body).success).toBe(true);
      if (r.type === 'flashcard') expect(flashcardBody.safeParse(r.body).success).toBe(true);
      if (r.type === 'interactive')
        expect(interactiveDefinition.safeParse(r.body).success).toBe(true);
      if (r.type === 'question') {
        const full = questionBody.safeParse({
          ...r.body,
          answer: r.answer,
          explanation: r.explanation,
        });
        expect(full.success, JSON.stringify(full.error?.issues)).toBe(true);
        // the stored public body must equal what a client is allowed to see
        expect(toClientQuestion(full.data!)).toEqual(r.body);
        if (r.body.type === 'numerical')
          expect(gradeAnswer(full.data!, { value: 10 }).correct).toBe(true);
      }
    }
    const env = contentEnvelope.safeParse({
      type: 'note',
      title: 't',
      language: 'en',
      ownership: 'official',
      sourceType: 'original',
    });
    expect(env.success).toBe(true);
    // no prerequisite cycles possible
    await expect(
      db.query(
        `insert into concept_prerequisites values ('50000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002')`,
      ),
    ).rejects.toThrow(/cycle/);
  });
});
