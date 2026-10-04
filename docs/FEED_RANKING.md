# Feed ranking (`ranking_v1`)

```text
final_score = Σ weight_k × feature_k  −  Σ repetition_penalty_j
```

| Feature (0–1)           | Weight | Meaning                                                                                         |
| ----------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| predicted_engagement    | .18    | mean of effective subject/format/hook/creator affinity, damped by session fatigue on hard items |
| predicted_learning_gain | .18    | .4 formatLearning + .2 hookLearning + .4 platform learning-gain stat (neutral .5 if unknown)    |
| learning_need           | .14    | max concept need (weak/stale/uncertain) + due-review bonus .35 + exam relevance ×.2             |
| personal_interest       | .10    | .7 subject + .3 creator + .2 followed                                                           |
| hook_affinity           | .08    | effective hook affinity                                                                         |
| difficulty_fit          | .08    | 1 − \|difficulty − target\|/0.5, target = ability + stretch (eased by frustration)              |
| content_quality         | .06    | stored quality score (default .7 official / .5 other)                                           |
| novelty                 | .05    | unseen item, unseen format/hook/creator dims, freshness (14 d decay)                            |
| social_signal           | .05    | .6 popularity (likes/50) + .4 followed — never overrides fit by default                         |
| exploration             | .08    | mean uncertainty across dims                                                                    |

Weights sum to 1 (tested). They are **initial configurable values, not proven optimal**. Source: `packages/config` `RANKING_V1`; mirrored by a `ranking_versions` row (`algorithm` JSON, status, activation time, experiment, outcome metrics).
Other config: `explorationRatio .15`, repetition penalties `{content .5, concept .15, creator .08, hook .05, format .05}`, diversity `{creator 2, subject 4, format 4}`, `batchSize 10`.

## Versioning & change control

New algorithm ⇒ new `ranking_vN` in config + SQL row (draft) → experiment (`experiments.variants[].ranking_version`) → activate (single active enforced by a partial unique index).
`resolveRanking` assigns experiment variants deterministically (`sha256(user:key)`), stores `experiment_id`/`variant` on each `recommendations` row.

## Endless feed

No daily limit. The client prefetches when ≤3 items remain (`shouldFetchMore`); the server never repeats served items (seen set) and signals `exhausted` gracefully when inventory is low. Items in memory are bounded per batch (client list growth is unbounded in-session — trimming TODO).
