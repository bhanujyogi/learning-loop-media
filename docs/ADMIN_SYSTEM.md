# Admin system (`apps/admin`, Next.js 16)

Runs **as the signed-in staff user** under RLS (anon key + user JWT cookies via `@supabase/ssr`; `proxy.ts` refreshes sessions). No service-role key. `requireStaff(permission)` redirects to `/forbidden`
and is only a UX gate — Postgres is the boundary (every page query and mutation is subject to RLS/permissions; server actions re-check and call guarded RPCs).
Security headers: CSP, X-Frame-Options DENY, nosniff, referrer policy. Forms are keyboard accessible with visible focus.

| Page            | Permission                   | Does                                                                                                              |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overview        | any staff                    | counts (— if unreadable)                                                                                          |
| Moderation      | `moderation.review` (+`act`) | open reports grouped by target, inspect, approve/restrict/remove/restore with required reason (RPC)               |
| Content         | `moderation.review`          | search/filter by type & ownership; detail shows versions, provenance (+sources, license snapshots), quality gates |
| Sources         | `sources.manage`             | registry list; register source (rights default _unknown_, `needs_review`)                                         |
| Pipeline jobs   | `pipeline.run`               | job list with status/attempts/sanitised errors                                                                    |
| Recommendations | `analytics.read`             | ranking versions; per-learner recent feeds with signed `why_shown` contributions                                  |
| Experiments     | `experiments.manage`         | list                                                                                                              |
| Audit log       | `audit.read`                 | latest 200 privileged actions                                                                                     |

**Not built:** user management (search/roles/restrictions UI), official content editor (create/edit/schedule/disable), source status/trust editing, job retry/cancel buttons, analytics dashboards (content/creator/course/learning), experiment create/conclude, feature-flag toggles, candidate-source configuration. Operations that need cross-user aggregates should get dedicated security-definer views rather than service keys.
