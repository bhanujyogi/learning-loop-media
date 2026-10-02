import { updateAffinity, type LearnerFeatures } from '@learning-loop/recommendation-engine';
import { asUser, type Sql } from '../sql';
import { loadFeatures, saveFeatures } from './features-store';

export interface OnboardingInput {
  userId: string;
  examId?: string;
  examDate?: string; // YYYY-MM-DD
  educationLevel?: string;
  /** subject ids the learner is interested in */
  interestSubjectIds: string[];
}

/** Short cold-start capture: seeds weak priors (n=2) so the first batch explores quickly rather than locking in. */
export async function completeOnboarding(sql: Sql, input: OnboardingInput): Promise<void> {
  await asUser(sql, input.userId, async (tx) => {
    await tx.query(
      `insert into learner_profiles(user_id, exam_id, exam_date, education_level, interests, onboarding_completed)
       values ($1,$2,$3,$4,$5::text[], true)
       on conflict (user_id) do update set exam_id=excluded.exam_id, exam_date=excluded.exam_date, education_level=excluded.education_level, interests=excluded.interests, onboarding_completed=true`,
      [
        input.userId,
        input.examId ?? null,
        input.examDate ?? null,
        input.educationLevel ?? null,
        input.interestSubjectIds,
      ],
    );
    let f: LearnerFeatures = await loadFeatures(tx, input.userId);
    for (const s of input.interestSubjectIds) {
      let a = f.subject[s];
      a = updateAffinity(a, 0.6);
      a = updateAffinity(a, 0.6);
      f = { ...f, subject: { ...f.subject, [s]: a } };
    }
    const rel = input.examId
      ? await tx.query<{ concept_id: string; relevance: number }>(
          `select concept_id, relevance from exam_concepts where exam_id = $1`,
          [input.examId],
        )
      : [];
    f = {
      ...f,
      examDate: input.examDate ? Date.parse(input.examDate + 'T00:00:00Z') : null,
      examRelevance: Object.fromEntries(rel.map((r) => [r.concept_id, r.relevance])),
    };
    await saveFeatures(tx, f);
  });
}
