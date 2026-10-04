import {
  isSupportedLocale,
  PREPARATION_ABILITY_PRIOR,
  PREPARATION_LEVELS,
  type Locale,
  type PreparationLevel,
} from '@learning-loop/shared';
import { updateAffinity, type LearnerFeatures } from '@learning-loop/recommendation-engine';
import { asUser, type Sql } from '../sql.ts';
import { loadFeatures, saveFeatures } from './features-store.ts';

export interface OnboardingInput {
  userId: string;
  examId?: string;
  examDate?: string; // YYYY-MM-DD
  educationLevel?: string;
  /** UI/content language; stored in profiles.locale (the single learner language preference). */
  language?: Locale;
  /** Self-reported approximate level; seeds the cold-start ability prior only. */
  preparationLevel?: PreparationLevel;
  /** subject ids the learner is interested in */
  interestSubjectIds: string[];
}

/** Short cold-start capture: seeds weak priors (n=2) so the first batch explores quickly rather than locking in. */
export async function completeOnboarding(sql: Sql, input: OnboardingInput): Promise<void> {
  await asUser(sql, input.userId, async (tx) => {
    const level =
      input.preparationLevel && PREPARATION_LEVELS.includes(input.preparationLevel)
        ? input.preparationLevel
        : null;
    await tx.query(
      `insert into learner_profiles(user_id, exam_id, exam_date, education_level, preparation_level, interests, onboarding_completed)
       values ($1,$2,$3,$4,$5,$6::text[], true)
       on conflict (user_id) do update set exam_id=excluded.exam_id, exam_date=excluded.exam_date, education_level=excluded.education_level,
         preparation_level=excluded.preparation_level, interests=excluded.interests, onboarding_completed=true`,
      [
        input.userId,
        input.examId ?? null,
        input.examDate ?? null,
        input.educationLevel ?? null,
        level,
        input.interestSubjectIds,
      ],
    );
    // The single language preference lives in profiles.locale (RLS-scoped to the bound user for app_server).
    if (isSupportedLocale(input.language))
      await tx.query(`update profiles set locale = $2 where id = $1`, [
        input.userId,
        input.language,
      ]);
    let f: LearnerFeatures = await loadFeatures(tx, input.userId);
    // Cold-start prior only: the first graded answers move ability far more than this nudge.
    if (level) f = { ...f, ability: PREPARATION_ABILITY_PRIOR[level] };
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
