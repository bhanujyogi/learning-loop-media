import { detectWeakConcepts, type MasteryState } from '@learning-loop/learning-engine';
import { newLearnerFeatures, type LearnerFeatures } from '@learning-loop/recommendation-engine';
import { ms, ts, type Sql } from '../sql';

export const SEEN_CAP = 500;

export async function loadFeatures(sql: Sql, userId: string): Promise<LearnerFeatures> {
  const r = await sql.query<{ features: LearnerFeatures }>(
    `select features from user_features where user_id = $1`,
    [userId],
  );
  const base = newLearnerFeatures(userId);
  return r[0] ? { ...base, ...r[0].features, learnerId: userId } : base;
}

export async function saveFeatures(sql: Sql, f: LearnerFeatures): Promise<void> {
  const trimmed = { ...f, seenContentIds: f.seenContentIds.slice(-SEEN_CAP) };
  await sql.query(
    `insert into user_features(user_id, features, updated_at) values ($1, $2::jsonb, now())
     on conflict (user_id) do update set features = excluded.features, updated_at = now()`,
    [f.learnerId, JSON.stringify(trimmed)],
  );
}

interface MasteryRow {
  concept_id: string;
  alpha: number;
  beta: number;
  exposures: number;
  correct: number;
  incorrect: number;
  mistake_streak: number;
  repeated_mistakes: number;
  last_evidence_at: Date | null;
}
export const rowToState = (r: MasteryRow): MasteryState => ({
  alpha: r.alpha,
  beta: r.beta,
  exposures: r.exposures,
  correct: r.correct,
  incorrect: r.incorrect,
  mistakeStreak: r.mistake_streak,
  repeatedMistakes: r.repeated_mistakes,
  lastEvidenceAt: ms(r.last_evidence_at),
});

/** Recompute weak-concept needs + due reviews into the learner features (called after learning events / by a job). */
export async function refreshLearningNeeds(
  sql: Sql,
  f: LearnerFeatures,
  now: number,
): Promise<LearnerFeatures> {
  const rows = await sql.query<MasteryRow>(
    `select * from concept_mastery where user_id = $1 order by updated_at desc limit 500`,
    [f.learnerId],
  );
  const states = new Map(rows.map((r) => [r.concept_id, rowToState(r)]));
  const ids = [...states.keys()];
  const prereq = ids.length
    ? await sql.query<{ concept_id: string; prerequisite_id: string }>(
        `select concept_id, prerequisite_id from concept_prerequisites where concept_id = any($1::uuid[])`,
        [ids],
      )
    : [];
  const refs = ids.map((id) => ({
    id,
    prerequisiteIds: prereq.filter((p) => p.concept_id === id).map((p) => p.prerequisite_id),
  }));
  const weak = detectWeakConcepts(refs, states, now, 100);
  const due = await sql.query<{ concept_id: string }>(
    `select distinct concept_id from review_items where user_id = $1 and concept_id is not null and due_at <= ${ts(2)} limit 200`,
    [f.learnerId, now],
  );
  return {
    ...f,
    conceptNeed: Object.fromEntries(weak.map((w) => [w.conceptId, w.need])),
    dueConceptIds: due.map((d) => d.concept_id),
  };
}
