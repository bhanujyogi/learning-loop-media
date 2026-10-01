import {
  applyEvidence,
  classify,
  dayIndex,
  estimate,
  gradeFromPerformance,
  levelFromXp,
  newMasteryState,
  newReviewCard,
  scheduleReview,
  updateFrustration,
  updateLearnerAbility,
  updateStreak,
  xpFor,
  type KnowledgeLevel,
  type ReviewCardState,
} from '@learning-loop/learning-engine';
import { applyFeedback } from '@learning-loop/recommendation-engine';
import { sanitizeEvent } from '@learning-loop/analytics';
import { gradeAnswer, questionBody } from '@learning-loop/validation';
import { ms, ts, type Sql } from '../sql';
import { loadFeatures, refreshLearningNeeds, rowToState, saveFeatures } from './features-store';

export interface SubmitAnswerInput {
  userId: string;
  questionId: string;
  response: unknown;
  responseMs?: number;
  hintsUsed?: number;
  confidence?: number;
  idempotencyKey?: string;
  now?: number;
}

export interface SubmitAnswerResult {
  attemptId: string;
  correct: boolean;
  score: number;
  explanation: string;
  /** Revealed only AFTER the attempt is recorded. */
  correctAnswer: unknown;
  xp: { awarded: number; total: number; level: number; leveledUp: boolean };
  mastery: { conceptId: string; mastery: number; confidence: number; level: KnowledgeLevel }[];
  nextReviewAt: number;
  achievements: string[];
  replayed: boolean;
}

export class DomainFailure extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_input' | 'forbidden',
    message: string,
  ) {
    super(message);
  }
}

interface QuestionRow {
  id: string;
  difficulty: number | null;
  hook: string | null;
  format: string | null;
  version_id: string;
  body: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation: string;
}

/**
 * Grades server-side and applies ALL learning consequences atomically & idempotently:
 * attempt → mastery → ability/frustration → spaced repetition → XP/streak → learner features.
 * The client never sees the answer key before this call and cannot write any of these tables.
 */
export async function submitAnswer(db: Sql, input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
  const now = input.now ?? Date.now();
  if (
    input.hintsUsed !== undefined &&
    (!Number.isInteger(input.hintsUsed) || input.hintsUsed < 0 || input.hintsUsed > 20)
  )
    throw new DomainFailure('invalid_input', 'hintsUsed');
  if (input.confidence !== undefined && !(input.confidence >= 0 && input.confidence <= 1))
    throw new DomainFailure('invalid_input', 'confidence');
  if (input.responseMs !== undefined && !(input.responseMs >= 0 && input.responseMs < 86_400_000))
    throw new DomainFailure('invalid_input', 'responseMs');

  return db.transaction(async (tx) => {
    // idempotent replay
    if (input.idempotencyKey) {
      const prev = await tx.query<{
        id: string;
        correct: boolean;
        score: number;
        content_version_id: string;
      }>(
        `select id, correct, score, content_version_id from question_attempts where user_id = $1 and idempotency_key = $2`,
        [input.userId, input.idempotencyKey],
      );
      if (prev[0]) {
        const k = await tx.query<{ answer: unknown; explanation: string }>(
          `select answer, explanation from content_answer_keys where content_version_id = $1`,
          [prev[0].content_version_id],
        );
        const progress = await tx.query<{ xp: number; level: number }>(
          `select xp, level from user_progress where user_id = $1`,
          [input.userId],
        );
        return {
          attemptId: prev[0].id,
          correct: prev[0].correct,
          score: prev[0].score,
          explanation: k[0]?.explanation ?? '',
          correctAnswer: k[0]?.answer,
          xp: {
            awarded: 0,
            total: progress[0]?.xp ?? 0,
            level: progress[0]?.level ?? 1,
            leveledUp: false,
          },
          mastery: [],
          nextReviewAt: now,
          achievements: [],
          replayed: true,
        };
      }
    }

    const qs = await tx.query<QuestionRow>(
      `select c.id, c.difficulty, c.hook, c.format, v.id as version_id, v.body, k.answer, k.explanation
         from content_items c
         join content_versions v on v.id = c.current_version_id
         join content_answer_keys k on k.content_version_id = v.id
        where c.id = $1 and c.type = 'question' and c.publishing = 'published' and c.deleted_at is null
          and c.moderation in ('none','cleared','pending_review')
          and not (c.owner_user_id is not null and app.is_blocked_between($2, c.owner_user_id))`,
      [input.questionId, input.userId],
    );
    const q = qs[0];
    if (!q) throw new DomainFailure('not_found', 'question not available');
    const parsed = questionBody.safeParse({
      ...q.body,
      answer: q.answer,
      explanation: q.explanation,
    });
    if (!parsed.success) throw new DomainFailure('invalid_input', 'stored question is malformed');
    const grade = gradeAnswer(parsed.data, input.response);

    const prior = await tx.query<{
      n: number;
      last_correct_at: Date | null;
      recent_misses: number;
    }>(
      `select count(*)::int as n, max(created_at) filter (where correct) as last_correct_at,
              (count(*) filter (where not correct and created_at > ${ts(3)} - interval '10 minutes'))::int as recent_misses
         from question_attempts where user_id = $1 and question_id = $2`,
      [input.userId, q.id, now],
    );
    const attemptNo = (prior[0]?.n ?? 0) + 1;
    /** Retries = recent misses on this same question (a retry in the same sitting), not lifetime attempts. */
    const retries = prior[0]?.recent_misses ?? 0;
    const lastCorrect = ms(prior[0]?.last_correct_at);
    const delayed = lastCorrect != null && now - lastCorrect > 86_400_000;

    const ins = await tx.query<{ id: string }>(
      `insert into question_attempts(user_id, question_id, content_version_id, response, correct, score, response_ms, hints_used, confidence, attempt_no, idempotency_key, created_at)
       values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11, ${ts(12)}) returning id`,
      [
        input.userId,
        q.id,
        q.version_id,
        JSON.stringify(input.response ?? null),
        grade.correct,
        grade.score,
        input.responseMs ?? null,
        input.hintsUsed ?? 0,
        input.confidence ?? null,
        attemptNo,
        input.idempotencyKey ?? null,
        now,
      ],
    );
    const attemptId = ins[0]!.id;

    // ---- mastery per linked concept
    const concepts = (
      await tx.query<{ concept_id: string }>(
        `select concept_id from content_concepts where content_id = $1`,
        [q.id],
      )
    ).map((r) => r.concept_id);
    const difficulty = q.difficulty ?? 0.5;
    const masteryOut: SubmitAnswerResult['mastery'] = [];
    const newlyMastered: string[] = [];
    for (const conceptId of concepts) {
      const row = (
        await tx.query<Parameters<typeof rowToState>[0]>(
          `select * from concept_mastery where user_id = $1 and concept_id = $2 for update`,
          [input.userId, conceptId],
        )
      )[0];
      const before = row ? rowToState(row) : newMasteryState();
      const levelBefore = classify(before, now);
      const after = applyEvidence(before, {
        kind: delayed && grade.correct ? 'delayed_recall' : 'answer',
        correct: grade.correct,
        difficulty,
        hintsUsed: input.hintsUsed,
        confidence: input.confidence,
        at: now,
      });
      await tx.query(
        `insert into concept_mastery(user_id, concept_id, alpha, beta, exposures, correct, incorrect, mistake_streak, repeated_mistakes, last_evidence_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${ts(10)}, now())
         on conflict (user_id, concept_id) do update set alpha=excluded.alpha, beta=excluded.beta, exposures=excluded.exposures, correct=excluded.correct,
           incorrect=excluded.incorrect, mistake_streak=excluded.mistake_streak, repeated_mistakes=excluded.repeated_mistakes, last_evidence_at=excluded.last_evidence_at, updated_at=now()`,
        [
          input.userId,
          conceptId,
          after.alpha,
          after.beta,
          after.exposures,
          after.correct,
          after.incorrect,
          after.mistakeStreak,
          after.repeatedMistakes,
          now,
        ],
      );
      const est = estimate(after, now);
      const levelAfter = classify(after, now);
      if (levelAfter === 'mastered' && levelBefore !== 'mastered') newlyMastered.push(conceptId);
      masteryOut.push({
        conceptId,
        mastery: est.mastery,
        confidence: est.confidence,
        level: levelAfter,
      });
    }

    // ---- learner ability / frustration + item difficulty
    await tx.query(`insert into learner_profiles(user_id) values ($1) on conflict do nothing`, [
      input.userId,
    ]);
    const lp = (
      await tx.query<{ ability: number; frustration: number }>(
        `select ability, frustration from learner_profiles where user_id = $1 for update`,
        [input.userId],
      )
    )[0]!;
    const ability = updateLearnerAbility(lp.ability, difficulty, grade.correct);
    const frustration = updateFrustration(lp.frustration, {
      correct: grade.correct,
      hintsUsed: input.hintsUsed,
      retries,
    });
    await tx.query(
      `update learner_profiles set ability = $2, frustration = $3 where user_id = $1`,
      [input.userId, ability, frustration],
    );
    await tx.query(`insert into content_stats(content_id) values ($1) on conflict do nothing`, [
      q.id,
    ]);
    await tx.query(
      `update content_stats set answers = answers + 1, correct_answers = correct_answers + $2, updated_at = now() where content_id = $1`,
      [q.id, grade.correct ? 1 : 0],
    );
    // Item-difficulty re-estimation (learning-engine updateItemDifficulty) is applied by the analytics job from aggregated attempts, not live.

    // ---- spaced repetition (FSRS)
    const ri = (
      await tx.query<Record<string, unknown>>(
        `select * from review_items where user_id = $1 and content_id = $2`,
        [input.userId, q.id],
      )
    )[0];
    const card: ReviewCardState = ri
      ? {
          due: ms(ri.due_at as Date)!,
          stability: ri.stability as number,
          difficulty: ri.difficulty as number,
          elapsedDays: ri.elapsed_days as number,
          scheduledDays: ri.scheduled_days as number,
          reps: ri.reps as number,
          lapses: ri.lapses as number,
          learningSteps: ri.learning_steps as number,
          state: ri.state as ReviewCardState['state'],
          lastReview: ms(ri.last_review_at as Date | null),
          schedulerVersion: 'fsrs_v1',
        }
      : newReviewCard(now);
    const g = gradeFromPerformance({
      correct: grade.correct,
      responseMs: input.responseMs,
      expectedMs: (parsed.data.expectedSeconds ?? 0) * 1000 || undefined,
      hintsUsed: input.hintsUsed,
      attempts: retries + 1,
      confidence: input.confidence,
    });
    const next = scheduleReview(card, g, now);
    const upsert = await tx.query<{ id: string }>(
      `insert into review_items(user_id, content_id, concept_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, state, last_review_at, scheduler_version)
       values ($1,$2,$3, ${ts(4)}, $5,$6,$7,$8,$9,$10,$11,$12, ${ts(13)}, $14)
       on conflict (user_id, content_id) do update set due_at=excluded.due_at, stability=excluded.stability, difficulty=excluded.difficulty, elapsed_days=excluded.elapsed_days,
         scheduled_days=excluded.scheduled_days, reps=excluded.reps, lapses=excluded.lapses, learning_steps=excluded.learning_steps, state=excluded.state, last_review_at=excluded.last_review_at, scheduler_version=excluded.scheduler_version
       returning id`,
      [
        input.userId,
        q.id,
        concepts[0] ?? null,
        next.due,
        next.stability,
        next.difficulty,
        next.elapsedDays,
        next.scheduledDays,
        next.reps,
        next.lapses,
        next.learningSteps,
        next.state,
        next.lastReview ?? now,
        next.schedulerVersion,
      ],
    );
    await tx.query(
      `insert into review_history(review_item_id, user_id, grade, reviewed_at, prev_state) values ($1,$2,$3, ${ts(4)}, $5::jsonb)`,
      [upsert[0]!.id, input.userId, g, now, JSON.stringify(card)],
    );

    // ---- XP / streak / level (idempotent per attempt)
    const awardedBase = grade.correct
      ? xpFor('question_correct')
      : xpFor('question_incorrect_attempt');
    const masteredBonus = newlyMastered.length * xpFor('concept_mastered');
    const awarded = awardedBase + masteredBonus;
    const ledger = await tx.query<{ id: number }>(
      `insert into xp_ledger(user_id, action, amount, ref_kind, ref_id, idempotency_key) values ($1,$2,$3,'question_attempt',$4,$5) on conflict (user_id, idempotency_key) do nothing returning id`,
      [
        input.userId,
        grade.correct ? 'question_correct' : 'question_incorrect_attempt',
        awarded,
        attemptId,
        `attempt:${attemptId}`,
      ],
    );
    await tx.query(`insert into user_progress(user_id) values ($1) on conflict do nothing`, [
      input.userId,
    ]);
    const prog = (
      await tx.query<{
        xp: number;
        level: number;
        streak_current: number;
        streak_longest: number;
        last_active_day: number | null;
      }>(`select * from user_progress where user_id = $1 for update`, [input.userId])
    )[0]!;
    const granted = ledger.length ? awarded : 0;
    const total = prog.xp + granted;
    const lvl = levelFromXp(total);
    const streak = updateStreak(
      { current: prog.streak_current, longest: prog.streak_longest, lastDay: prog.last_active_day },
      dayIndex(now),
    );
    await tx.query(
      `update user_progress set xp=$2, level=$3, streak_current=$4, streak_longest=$5, last_active_day=$6, updated_at=now() where user_id=$1`,
      [input.userId, total, lvl.level, streak.current, streak.longest, streak.lastDay],
    );

    const achievements: string[] = [];
    const grant = async (code: string) => {
      const r = await tx.query(
        `insert into user_achievements(user_id, code) values ($1,$2) on conflict do nothing returning code`,
        [input.userId, code],
      );
      if (r.length) achievements.push(code);
    };
    if (grade.correct) await grant('first_correct');
    if (newlyMastered.length) await grant('concept_mastered_1');
    if (streak.current >= 3) await grant('streak_3');

    // ---- raw events (taxonomy-sanitised)
    const evs = [
      sanitizeEvent(
        {
          name: 'question_answered',
          payload: {
            question_id: q.id,
            attempt_id: attemptId,
            response_ms: input.responseMs,
            hints_used: input.hintsUsed ?? 0,
            attempt_no: attemptNo,
          },
        },
        now,
      ),
      sanitizeEvent(
        {
          name: grade.correct ? 'answer_correct' : 'answer_incorrect',
          payload: { question_id: q.id, concept_id: concepts[0], response_ms: input.responseMs },
        },
        now,
      ),
    ];
    for (const e of evs)
      if (e)
        await tx.query(
          `insert into events(user_id, name, payload, client_at) values ($1,$2,$3::jsonb, ${ts(4)})`,
          [input.userId, e.name, JSON.stringify(e.payload), e.at],
        );

    // ---- learner features: Model B (learning response) + needs
    let f = await loadFeatures(tx, input.userId);
    f = applyFeedback(f, {
      type: 'learning',
      name: grade.correct
        ? delayed
          ? 'delayed_recall_success'
          : 'answer_correct'
        : 'answer_incorrect',
      format: q.format ?? undefined,
      hook: q.hook,
    });
    const worst = masteryOut.some((m) => m.level === 'weak');
    if (!grade.correct && worst)
      f = applyFeedback(f, {
        type: 'learning',
        name: 'repeated_mistake',
        format: q.format ?? undefined,
        hook: q.hook,
      });
    if (newlyMastered.length)
      f = applyFeedback(f, {
        type: 'learning',
        name: 'concept_mastered',
        format: q.format ?? undefined,
        hook: q.hook,
      });
    f = { ...f, ability, frustration };
    f = await refreshLearningNeeds(tx, f, now);
    await saveFeatures(tx, f);

    return {
      attemptId,
      correct: grade.correct,
      score: grade.score,
      explanation: q.explanation,
      correctAnswer: q.answer,
      xp: { awarded: granted, total, level: lvl.level, leveledUp: lvl.level > prog.level },
      mastery: masteryOut,
      nextReviewAt: next.due,
      achievements,
      replayed: false,
    };
  });
}
