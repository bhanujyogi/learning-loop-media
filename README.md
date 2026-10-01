# Learning Loop

A mobile-first social learning network: an endless, personalised feed of short learning content where every
interaction (answers, saves, skips, reviews) improves what the learner sees next — optimised for _learning_, not screen time.

Initial focus: SSC, Railway, Banking and Rajasthan competitive exams. The architecture is exam-agnostic (exams, syllabi, subjects,
concepts and prerequisites are **data**).

> **Start here if you are a new engineer or a new Claude session:** read [`CLAUDE.md`](CLAUDE.md) → [`PROJECT_STATUS.md`](PROJECT_STATUS.md) → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```text
apps/
  mobile/   Expo (React Native, TypeScript, Expo Router) — the consumer app
  admin/    Next.js — staff-only operations UI (moderation, provenance, sources, jobs, recommendation debugger)
packages/
  shared/                 domain vocabulary (enums), Result type, structured logging
  config/                 versioned product config: ranking weights, XP, feature flags, rate limits
  validation/             zod content schemas + server-side grading + answer-leak protection
  learning-engine/        mastery (Beta + decay), FSRS scheduling, difficulty, weak-concept detection, XP/streaks
  recommendation-engine/  learner features, scoring, explainability, repetition/diversity/exploration, sequencing
  content-engine/         license evaluation, quality gates, dedup, publish safeguards, job state machine
  analytics/              event taxonomy + privacy sanitiser
  ai/                     local-AI provider abstraction (no cloud runtime dependency)
  database/               server-side services (submitAnswer, getFeed, …), StorageProvider, DB test harness (PGlite)
supabase/
  migrations/  13 ordered SQL migrations (schema, RLS, guards)   seed/  dev seed   functions/  Edge Function wrappers
docs/           specifications and decisions
```

## Quick start

```bash
corepack enable && pnpm install
pnpm check            # typecheck + lint + all tests (incl. migrations/RLS against real Postgres via PGlite)
pnpm test             # tests only
```

Run the stack locally (needs Docker + the Supabase CLI — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

```bash
supabase start && supabase db reset          # applies migrations + dev seed
cp .env.example .env                         # fill the anon key printed by `supabase start`
pnpm --filter @learning-loop/mobile exec expo start
pnpm --filter @learning-loop/admin dev
```

## Ground rules (full list in CLAUDE.md)

- The database enforces authorization (RLS + guard triggers + security-definer functions). Frontend checks are never the boundary.
- Never ship a service-role key to a client. Public env vars only.
- Answers are graded server-side; clients never receive answer keys before answering.
- External content: _access ≠ reuse_. Unclear rights → `flag_for_review`.
- Runtime AI is on-device only; no paid cloud AI on any runtime path.
