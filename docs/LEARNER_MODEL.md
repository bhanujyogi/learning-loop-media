# Learner model

The learner graph is a set of **estimates with confidence/recency**, not truths.

## Stored per learner

- `concept_mastery` (per concept): α, β, exposures, correct, incorrect, mistake_streak, repeated_mistakes, last_evidence_at, `algorithm_version`.
- `learner_profiles`: exam, exam date, level, interests, `ability` (0–1), `frustration` (0–1), onboarding flags. Ability/frustration are server-derived.
- `review_items`: FSRS state per flashcard/question.
- `user_features.features` (`LearnerFeatures`, `features_v1`): Model A/B affinities and context (below). Private: only `analytics.read` staff can read; never exposed to other learners.

## Two models (kept distinct)

**A — engagement preference** `subject, format, hook, creator` → `Affinity {score 0..1, n}` updated from engagement events (save +1.0, replay +.8, share +.8, follow +.9, like +.7, comment +.7, complete +.6, immediate skip −.7, skip −.3, report −1).
**B — learning response** `formatLearning, hookLearning` updated only from server-graded evidence (correct +.6, incorrect −.5, repeated mistake −.9, delayed recall +1, concept mastered +1).
`updateAffinity` = running mean early, EMA later (rate floor 0.05); `effective()` shrinks toward 0.5 with a prior of 3 observations so one tap can't lock a preference; `uncertainty()=1/√(1+n)` feeds exploration.
Engagement ≠ learning: a format can be high-A/low-B (the engine keeps both; admin debugger shows both contributions).

## Context features

`conceptNeed` (weak/stale/uncertain, from learning-engine), `dueConceptIds`, `examRelevance`, `examDate`, `followedCreatorIds`, `blockedCreatorIds`, `seenContentIds` (cap 500), `recent` window (content/concept/creator/hook/format), `sessionFatigue`.

## Cold start

`completeOnboarding`: exam + subjects + optional date (short). Seeds subject affinity with n=2 (weak prior) and syllabus relevance; first batches include exploration slots to learn format/hook/difficulty quickly. A short diagnostic card sequence is TODO.

## Privacy

Behavioural/learning data is private to the learner and staff with `analytics.read`. Private messages are never used as signals. Aggregated global signals (future) must be non-identifying.
