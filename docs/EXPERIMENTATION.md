# Experimentation

Tables: `experiments` (key, hypothesis, status, population JSON, `variants` `[{name, weight, ranking_version?, config?}]`, window, metrics, results), `experiment_assignments` (sticky per user), `ranking_versions.experiment_id`, `recommendations.experiment_id/variant`.
Implemented: ranking-version experiments with deterministic weighted bucketing and sticky assignment (tested). Admin can list experiments.
Planned: hook-strategy, sequencing, onboarding and difficulty experiments (same assignment mechanism, different `config` keys); metrics job writing `results`; guardrail metrics.
**Metrics beyond watch time** (docs/ANALYTICS.md §Metrics): completion, question participation, correctness, delayed recall, mastery gain, satisfaction (saves, reports, skips), D1/D7 voluntary return.
Rule: the algorithm is never changed without a recorded version/experiment.
