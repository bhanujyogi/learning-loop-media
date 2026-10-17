import { parseCreatorSubmission } from '@learning-loop/validation';
import { DomainFailure } from './learning.ts';
import { asUser, type Sql } from '../sql.ts';

export interface CreatedContent {
  contentId: string;
  /** 'cleared' = live for everyone (trusted creator); 'pending_review' = waiting for a moderator (visible to the owner only) */
  moderation: string;
}

/**
 * Creates and publishes a creator's note / flashcard / question as the CALLER: the SQL runs under the `authenticated`
 * role with the caller's identity, so row-level security, the guard triggers, creator restrictions and the upload rate
 * limit apply exactly as they would for a direct client write. The service adds what the database cannot: the submission is
 * validated with the same schemas the renderer and grader use, a question's key never enters the public body, and the whole
 * thing is ONE transaction (a failure leaves nothing behind).
 */
export async function createContent(
  db: Sql,
  userId: string,
  input: unknown,
): Promise<CreatedContent> {
  const parsed = parseCreatorSubmission(input);
  if (!parsed.ok) throw new DomainFailure('invalid_input', parsed.error);
  const c = parsed.value;
  try {
    return await asUser(db, userId, async (tx) => {
      const concept = await tx.query<{ id: string }>(`select id from concepts where id = $1`, [
        c.conceptId,
      ]);
      if (!concept.length) throw new DomainFailure('invalid_input', 'unknown_concept');
      const item = await tx.query<{ id: string }>(
        `insert into content_items(type, title, language, ownership, format, hook, difficulty, learning_objective)
         values ($1::content_type, $2, $3, 'user', $4::format_type, $5::hook_type, $6, 'Community content')
         returning id`,
        [c.kind, c.title, c.language, c.format, c.hook, c.difficulty],
      );
      const id = item[0]!.id;
      const v = await tx.query<{ id: string }>(
        `insert into content_versions(content_id, body) values ($1, $2::jsonb) returning id`,
        [id, JSON.stringify(c.body)],
      );
      if (c.key)
        await tx.query(
          `insert into content_answer_keys(content_version_id, answer, explanation) values ($1, $2::jsonb, $3)`,
          [v[0]!.id, JSON.stringify(c.key.answer), c.key.explanation],
        );
      await tx.query(
        `insert into content_concepts(content_id, concept_id, role) values ($1, $2, $3)`,
        [id, c.conceptId, c.kind === 'question' ? 'assesses' : 'primary'],
      );
      // the upload must be finalised BEFORE publishing so an unavailable video can never go live
      if (c.mediaId) await tx.query(`select finalize_my_video($1, $2)`, [c.mediaId, id]);
      await tx.query(`select publish_content($1)`, [id]);
      const m = await tx.query<{ moderation: string }>(
        `select moderation::text from content_items where id = $1`,
        [id],
      );
      return { contentId: id, moderation: m[0]!.moderation };
    });
  } catch (e) {
    if (e instanceof DomainFailure) throw e;
    const code = (e as { code?: string }).code;
    if (code === '54000') throw new DomainFailure('rate_limited', 'too many uploads');
    if (code === '22023')
      throw new DomainFailure('invalid_input', (e as Error).message.split(':')[0]!);
    if (code === '42501') throw new DomainFailure('forbidden', 'uploads not allowed');
    throw e;
  }
}
