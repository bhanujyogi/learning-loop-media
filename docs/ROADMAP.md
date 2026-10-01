# Roadmap (dependency-ordered)

Legend: ✅ done · 🟡 partial · ⬜ not started. Source of truth for status details: `PROJECT_STATUS.md`.

| Milestone                | State | Notes                                                                                                                               |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0 Repo inspection        | ✅    | repo was empty                                                                                                                      |
| 1 Engineering foundation | ✅    | pnpm monorepo, TS, lint, format, tests, CI, docs                                                                                    |
| 2 Supabase foundation    | ✅    | migrations, RLS, seed, auth integration (mobile/admin), profile bootstrap                                                           |
| 3 Content foundation     | ✅    | model, graph, versions, answer keys, provenance, ownership, states                                                                  |
| 4 User content           | 🟡    | DB rules complete (draft/publish/unpublish/delete/report); **no creator UI** (create/edit/preview/upload)                           |
| 5 Official infra         | 🟡    | identities, permissions, gates, provenance, jobs table, source registry, audit ✅; **no workers/fetchers/generators** (intentional) |
| 6 Learning engine        | ✅    | mastery, FSRS, difficulty, weak concepts, attempts, XP                                                                              |
| 7 Feed                   | 🟡    | vertical feed, bounded candidates, ranking, events ✅; real video untested; needs perf profiling                                    |
| 8 Personalization        | ✅/🟡 | affinities, difficulty, need, penalties, exploration, explanations ✅; diagnostic onboarding, alt-representation resurfacing ⬜     |
| 9 Self-improving loop    | 🟡    | ranking versions, experiments, bandit helpers, diagnostics ✅; aggregation jobs, outcome metrics, content-quality loop ⬜           |
| 10 Social                | 🟡    | DB + like/save in feed; profiles/comments/follow/notifications UI ⬜                                                                |
| 11 Messaging             | 🟡    | DB + rules + tests; UI/realtime wiring ⬜                                                                                           |
| 12 Gamification          | 🟡    | XP/streak/level/achievements server + learn tab; caps, badges UI ⬜                                                                 |
| 13 Interactive           | ✅/🟡 | 5 renderers (tap/ordering/matching/timeline/map); diagram, map-question UI ⬜                                                       |
| 14 Local AI              | 🟡    | abstraction + gating + truthfulness ✅; runtime/model mgmt ⬜ (decision gate in AI_ARCHITECTURE.md)                                 |
| 15 Admin                 | 🟡    | 8 read/moderate pages; editor, user mgmt, analytics ⬜                                                                              |
| 16 Hardening             | ⬜/🟡 | RLS/security tests ✅; real-Supabase integration, perf, a11y audit, dep audit gate, pen-test ⬜                                     |

## Next (recommended order)

1. Run the stack on real Supabase CLI; verify Edge Functions; fix integration drift. 2. Creator flow (draft/preview/publish/upload + server media finaliser). 3. Scheduled workers (feature aggregation, retention, review-due notifications).
2. Profiles/follow/comments UI. 5. First real official content through the pipeline using explicitly licensed sources (register in source registry first). 6. Device performance profiling + FlashList decision. 7. Local-AI runtime spike behind the existing provider.
