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
