# Recommendation engine

Interpretable first, learnable later. Pure package `packages/recommendation-engine`; orchestration in `database/services/feed.ts`.

```text
rule-based ranking (ranking_v1, now) → personalised scoring (now: Model A/B) → exploration/exploitation (now)
  → contextual bandits (helpers present: Thompson sampling) → learned ranking (when data justifies)
```

## Candidate generation (bounded, multi-source)

`weak_concept`, `review_due`, `exam_requirement`, `interest`, `followed_creator`, `saved_topic` (concepts of saved content), `adjacent_concept` (unseen concepts whose prerequisites are ≥0.65 mastered — "next up"), `challenge` (difficulty ≥ ability+0.15), `related` (relation edges from recently shown content), `new_content` (7 d), `high_quality`, `exploration` (seeded pseudo-random unseen).
Not yet generated: `trending` (must additionally pass quality/relevance/safety/novelty/fit — design in ROADMAP). A candidate can carry several sources.

## Pipeline per request (`getFeed`)

identify learner → load `user_features` → candidate pools (each `limit`ed) → eligibility (`filterEligible`: published, moderation ok, freshness, blocked creators, already-seen unless due review, pool duplicates; reasons recorded) →
score (`scoreCandidate`) → repetition penalties (content/concept/creator/hook/format; **not applied to deliberate review**) → greedy selection with diversity caps (creator/subject/format; relaxed ×2 if inventory is thin) +
reserved exploration slots (`round(batch × explorationRatio)`, sampled — not just top-k — from exploration candidates with a seeded PRNG) → sequencing → persist `recommendations` + `recommendation_items(why_shown)` → mark served items as seen → return client-safe items.
Heavy aggregation (concept needs) is computed on the learning-write path, not on each feed request.

## Explainability (mandatory)

Every item stores signed contributions: `learning_need`, `predicted_engagement`, `difficulty_fit`, `hook_affinity`, `personal_interest`, …, negative `recent_*` penalties, `deliberate_review`, `exploration_slot`. Invariant (tested): contributions + penalties = score.
Admin → Recommendations shows them per learner/request. "Why excluded" reasons are stored in `recommendations.diagnostics.excluded`.

## Sequencing

`sequenceBatch` orders roles introduction → application → prediction → challenge → explanation → review while keeping the top-ranked item first; no fake cliffhangers, ordering only.

## Exam proximity

`examPressure(examDate)`: >180 d 0 · ≤180 .15 · ≤90 .4 · ≤30 .75 · ≤7 1. Weights shift: `learning_need ×(1+p)`, `exploration ×(1−0.7p)`, `novelty ×(1−0.4p)` — a feature, never an override; interests keep their weight.

## Bandit readiness

`betaParams/sampleBeta/thompsonPick` operate on the same `Affinity` shape. `ranking_v2` can replace the exploration feature with Thompson draws without a schema change.

## Not yet

Collaborative filtering/global aggregate models, delayed-recall-based learning-gain targets, creator-level learning stats, diversity across difficulty, trending quality filter, offline evaluation harness.

## Trainable logging & authoritative configuration (audit H9)

- **Authoritative config:** `ranking_versions.algorithm` (weights, explorationRatio, repetition, diversity, batchSize) is loaded and **validated** (`parseRankingConfig`: exact keys, bounded finite numbers, weights sum to 1) on every request. It is immutable once the version leaves `draft`; status transitions are constrained (draft→active→retired) and audited; one active version (partial unique index). The code constant `RANKING_V1` is the migration's seed value and a **fail-safe fallback** only — used when the DB has no valid active version, and then recorded as `ranking_config.source='fallback'` + reason (never silent). `ranking_v1` in the DB equals the code constant (parity-tested).
- **Per recommendation** (`recommendations`): resolved config snapshot, `features_version`, compact `feature_snapshot` (ability, frustration, fatigue, exam pressure, counts, top affinities), `candidate_count`, `policy` (selection scheme, exploration ratio/slots, seed), experiment + variant.
- **Per item** (`recommendation_items`): score, signed `why_shown`, `decision` (`exploit` greedy | `explore` sampled), `propensity` (explore: 1/|sampling pool|; exploit: 1). Caveat: propensity is conditional on the state at that step and ignores the diversity-rejection step; exploit items are deterministic given state (probability 1), so off-policy estimation of exploit behaviour needs the exploration data.
- **Candidate log** (`recommendation_candidates`, ≤ 50 top by score + every selected item): rank, score, sources, selected flag, score components.
- **Outcomes:** `recommendation_outcomes` view (impressions, completes, likes, saves, shares, skips, immediate skips, answered, correct, incorrect per served item). Together this is the (context, action, propensity, reward) tuple set a contextual bandit / learned ranker needs. Not yet built: the training/evaluation job and reward definition.
