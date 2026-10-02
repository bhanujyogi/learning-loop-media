# Architecture

Learning Loop is a **modular monolith** on Supabase: one repo, clear domain boundaries, replaceable edges.

```text
                CONTENT ──► CONTENT GRAPH ──► FEED CANDIDATES ──► RECOMMENDATION ENGINE
                                                                         ▲
   STUDENT ──► LEARNING + BEHAVIOUR ──► LEARNER MODEL ───────────────────┘
```

## Runtime topology

```text
 Mobile (Expo)  ──anon JWT──►  Supabase Auth / PostgREST (RLS)      ← reads/writes allowed by policy only
      │                              │
      │ events / answers / feed      ▼
      └────────────► Edge Functions (verify JWT → services) ──► Postgres (privileged connection, server only)
 Admin (Next.js) ──staff JWT──► PostgREST under RLS (no service key)
```

- **Direct PostgREST** is used for things RLS can fully protect (own likes/saves/comments, drafts, reading public content, reports, messages).
- **Edge Functions** are used where integrity matters: grading (`submit-answer`), personalised ranking (`feed`), event ingestion (`events`),
  onboarding. They verify the caller's JWT with Supabase Auth, take the user id from the verified token (never the body), and call
  the tested services in `packages/database/src/services`. _Status: unverified locally — see PROJECT_STATUS.md._
- **Services take a `Sql` port** (`packages/database/src/sql.ts`). Production = Postgres driver in the Edge runtime; tests = PGlite. The mobile app has no implementation.

## Packages and dependency direction

```text
shared ◄─ config ◄─ learning-engine
shared ◄─ validation ◄─ content-engine
shared ◄─ analytics
shared + config ◄─ recommendation-engine
all of the above ◄─ database (services, storage, client)   ai ◄─ shared
apps/mobile → shared, config, analytics, validation, ai, database/client, learning-engine/gamification
apps/admin  → shared, config, validation, content-engine (+ Supabase as the signed-in user)
```

Pure packages have no I/O, so they are fast to test and safe to run anywhere (device, Edge, job).
`content-engine` and `database` root use `node:crypto` → **server-only**.

## The closed loop (what is implemented and tested end to end)

```text
getFeed ──► client renders ──► recordEvents (engagement)      ─┐
   ▲                         └► submitAnswer (server-graded)    ├─► user_features (Model A + Model B), concept_mastery,
   │                                                            │   review_items (FSRS), xp/streak, events
   └──────────── ranking_v1 scores candidates using ───────────┘
```

`packages/database/test/loop.test.ts` proves: wrong answers → weak concept → next feed prioritises it (with `why_shown`), idempotent grading,
delayed recall weighs more, FSRS intervals grow, raw events cannot forge mastery, experiments bucket stickily.

## Domain boundaries (conceptual services)

| Service                             | Where                                                              | Notes                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| FeedService / RecommendationService | `database/services/feed.ts` + `recommendation-engine`              | candidates → eligibility → score → diversity/exploration → sequence → persist diagnostics |
| LearningService / QuizService       | `database/services/learning.ts` + `learning-engine` + `validation` | grading, mastery, review, XP                                                              |
| ContentService / PublishingService  | SQL (`publish_content`, guards) + `content-engine`                 | gates, provenance, versions                                                               |
| ModerationService                   | SQL `apply_moderation_action`, report triggers                     | server-side only                                                                          |
| MessagingService                    | SQL `start_direct_conversation` + RLS/guards                       | realtime via Supabase on `messages`                                                       |
| MediaService                        | `database/media`                                                   | `StorageProvider` abstraction; Supabase Storage today                                     |
| AIService                           | `packages/ai`                                                      | local only                                                                                |

## Cross-cutting

- **Versioning**: migrations, `ranking_vN`, `mastery_v1`, `fsrs_v1`, `features_v1`, `content_schema_v1` (see CLAUDE.md).
- **Config**: `packages/config` (ranking, XP, flags, rate limits). SQL mirrors where needed, parity-tested.
- **Observability**: `packages/shared/log.ts` structured logger with redaction + `timed()`; swap sink for a vendor later. Recommendation diagnostics persisted
  (`recommendations`, `recommendation_items.why_shown`); pipeline job errors sanitised; `audit_log` for privileged actions.
- **Offline (mobile)**: one local store (`expo-sqlite/kv-store`) for the event queue; optimistic social toggles; answers need connectivity (server-graded) and say so.
- **Jobs**: `pipeline_jobs` (idempotency key, state machine, retries). Scheduled workers (feature aggregation, retention, source refresh) are designed, not yet running.

## What this deliberately is not

No microservices, Kubernetes, search cluster, streaming platform or heavyweight ML — see DECISIONS.md and ROADMAP.md for the evolution path.

## Update (audit remediation)

Server code never runs as a superuser: `Sql` port → `asUser(userId)` → one transaction under `app_server`/`app_jobs` (RLS applies, no BYPASSRLS). Learner features are read-modify-write under a row lock (`FOR UPDATE`; `loadFeatures` refuses to run outside a transaction). Ranking configuration lives in the database (validated, immutable once active) with the code constant as fallback. Workspace packages use explicit `.ts` import specifiers so they resolve under Deno, Metro, Next and Vitest alike.
