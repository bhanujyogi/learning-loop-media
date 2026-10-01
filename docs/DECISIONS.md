# Decisions

Format: Date · Problem · Options · Decision · Why · Trade-offs · Reconsider when.

## 2026-10-01 — Monorepo: pnpm workspaces, TypeScript source packages

- **Options**: npm/yarn workspaces; Nx/Turborepo; pnpm workspaces. **Decision**: pnpm workspaces, no build orchestrator, packages exported as `src/index.ts`.
- **Why**: simplest thing that works with Metro, Next (`transpilePackages`), Vitest and Deno import maps. Verified: Metro bundles; Next builds.
- **Trade-offs**: no incremental build cache. **Reconsider** when CI > ~10 min (add Turborepo).

## 2026-10-01 — Authorization lives in Postgres

- **Decision**: RLS + guard triggers + `SECURITY DEFINER` functions for state transitions (`publish_content`, `apply_moderation_action`, `start_direct_conversation`).
- **Why**: "no frontend-only authorization"; every client (mobile, admin, scripts) gets the same guarantees; testable in PGlite.
- **Trade-offs**: logic in SQL is harder to refactor; mitigated by tests. Policies use row-local predicates (not id-lookup helpers) so `INSERT … RETURNING` works (learned from a failing test).

## 2026-10-01 — Learner integrity: server-only writes for learning state

- **Decision**: no client write policies on attempts/mastery/reviews/XP/features; grading in `submitAnswer`; answer keys in a separate table.
- **Why**: prevents forged mastery/XP and answer scraping; keeps recommendation data trustworthy.
- **Trade-offs**: answering requires connectivity. **Reconsider** for an offline-practice mode with server reconciliation (never trusting client grades for mastery).

## 2026-10-01 — Spaced repetition: FSRS via `ts-fsrs`

- **Options**: SM-2; custom; FSRS (`ts-fsrs`, MIT, maintained — last publish 2026-09-29). **Decision**: FSRS wrapped behind `learning-engine/scheduler` with `fsrs_v1`, our own performance→grade mapping.
- **Why**: maintained, documented, parameterisable. We claim nothing beyond the FSRS authors' published evidence.
- **Reconsider**: when enough review history exists to fit per-learner parameters.

## 2026-10-01 — Mastery model: Beta pseudo-counts + exponential decay (`mastery_v1`)

- **Why**: interpretable (mean, confidence, uncertainty), cheap, naturally models staleness. **Trade-offs**: ignores item-level discrimination; no concept-graph propagation except weak-prerequisite surfacing. **Reconsider**: BKT/IRT when item volume justifies it.

## 2026-10-01 — Ranking: interpretable weighted sum first (`ranking_v1`), bandit-ready

- **Decision**: configurable weights from the product directive (sum = 1), signed contributions persisted as `why_shown`, Thompson-sampling helpers present but unused.
- **Why**: debuggable before learnable; data shapes already compatible with contextual bandits. **Reconsider** once ≥ tens of thousands of labelled impressions exist.

## 2026-10-01 — Single `pipeline_jobs` table instead of three job tables

- **Why**: ingestion/generation/publishing share state machine, idempotency and retry semantics; `kind` distinguishes (`DiscoverSources…PublishContent`). Fewer tables, one admin view.

## 2026-10-01 — Admin app runs as the signed-in staff user (no service-role key)

- **Why**: least privilege; same RLS as everyone; nothing privileged to leak. Staff capabilities come from `role_permissions`.
- **Trade-offs**: some cross-user analytics need dedicated security-definer views/functions later.

## 2026-10-01 — Official publishing identities are rows + permissions, authors ≠ validators

- **Decision**: `publishing_identities` + membership; `publish_content()` requires `content.publish_official` + membership + all gates + provenance; `pipeline.run` (writes gate results) is _not_ granted to authoring roles.
- **Why**: a compromised author/publisher account cannot self-certify content. (Test caught an initial seed where authors held `pipeline.run`.)

## 2026-10-01 — Storage: Supabase Storage behind `StorageProvider`; R2 deferred

- **Why**: cost and speed; logical references in `media_assets`; `CloudflareR2Provider` is an explicit unimplemented stub. Bytes are sniffed, declared MIME never trusted.

## 2026-10-01 — Local AI: abstraction now, runtime later

- **Evaluated** `llama.rn` (MIT; 0.13.0-rc.6 tagged `latest` at check time = release candidate; needs a dev build, not Expo Go) and `onnxruntime-react-native` (MIT, 1.24.3).
- **Decision**: build `AIProvider/AIService`, device gating, grounding, truthful unavailability; **do not bundle a runtime until** it is benchmarked on real low-end Android hardware and a model/licence is chosen. Documented in AI_ARCHITECTURE.md.
- **Why**: no fake AI, no unverified native dependency in the main bundle. **Reconsider** when llama.rn has a stable release and a ≤1B model passes our quality/latency bar.

## 2026-10-01 — Test infrastructure: PGlite instead of Docker Postgres

- **Why**: real Postgres semantics (RLS, triggers, plpgsql) in-process, no Docker in CI/sandbox; Supabase auth is stubbed (`auth.uid()` via a setting). **Limits**: not byte-identical to Supabase (no GoTrue, Realtime, Storage service); Edge Functions untested. Add a Supabase-local CI job when available.

## 2026-10-01 — Dependency pins

- `typescript ~5.9` in root, packages and admin (the Expo template pins ~6.0 for the mobile app, which typechecks cleanly); `vitest ^3.2` (5.x exists; no need yet); Expo packages pinned from `expo/bundledNativeModules.json` because `expo install` could not reach Expo's API from the sandbox.
