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

## 2026-10-02 — Audit remediation decisions

- **Gates bound to content by a database-computed hash (C2).** Options: lock the draft while gating; trust a validator-supplied hash; compute the hash in the DB and compare at publish. Chose the third: the validator cannot lie, any edit (even metadata/provenance/links) fails closed, no workflow state to manage. Trade-off: re-validation after every edit (intended). Also: checker ≠ author/uploader/identity member.
- **Reports weighted by account age; never auto-hide official/approved content (H3).** Kept auto-flagging (abuse of the report button must not be free _and_ real brigading must not be free either): weight 0.2 for accounts < 7 days, threshold 3.0, escalate instead of hide for official/cleared. Reconsider with real abuse data (add reporter reputation).
- **Anti-farming via evidence discount + XP rules, not by blocking retries (H4).** Learners legitimately retry; attempts are recorded, but repeats within 24 h carry decaying evidence (1, .25, .1, .05, 0), no ability/FSRS/feature updates, one XP award per question+action per UTC day, 400 XP/day cap. Reconsider the factors with data.
- **Least-privilege DB roles via `SET LOCAL ROLE` (H6).** Options: Supabase service key through PostgREST; privileged `postgres` connection (rejected: bypasses RLS/guards); dedicated login role per function; `SET LOCAL ROLE` from the platform connection. Chose `app_server`/`app_jobs` with explicit grants/policies, applied per transaction, plus an optional dedicated login role (`APP_DB_URL`) as the hard barrier. Honest limit: without the login role the downgrade is a convention.
- **Row lock instead of per-dimension tables (H8).** The feature document stays a JSON blob under `SELECT … FOR UPDATE`; simpler and sufficient at MVP concurrency (one lock per learner). Reconsider if feed latency suffers from lock waits.
- **Explicit `.ts` import specifiers (H7).** Options: bundle functions with esbuild; Deno sloppy-imports (not available to the hosted runtime); explicit extensions. Chose explicit extensions: no build step, works in Deno/Metro/Next/Vitest/tsc (all re-verified).
- **DB-authoritative ranking config with code fallback (H9).** Immutable once active, validated on load, fallback recorded on every recommendation.

## 2026-10-04 — Consumer mobile MVP decisions

- **One language preference: `profiles.locale`.** Options: a new `learner_profiles.language`; a local-only setting; the existing `profiles.locale`. Chose the existing column (validated by a new check constraint) so there is no parallel model. Before onboarding finishes the on-device/device language wins (the DB holds the schema default `en`); afterwards the account value is authoritative and follows the learner across devices (`resolveLocale`, tested). The server reads/updates only the bound user's `locale` through a column-scoped grant + row-scoped policy for `app_server`.
- **Language is an _eligibility_ rule in the feed, not a score change.** The feed serves `language ∈ {learner locale, 'en'}`. English is the universal fallback so a Hindi learner is never shown an empty feed while Hindi inventory is small. A _preference boost_ (Hindi first) would alter ranking behaviour, so by our rules it needs `ranking_v2` + an experiment record — deliberately not done silently here. There is no translation-link model between items yet (only `language` per item and `name_i18n` on curriculum rows); the UI never translates content at runtime.
- **UI strings: typed catalogues, not a runtime i18n library.** `apps/mobile/src/i18n` has one catalogue per locale; Hindi must provide every English key (compile-time) with the same placeholders (tested). Plurals via `_one/_other` + `count`. No dependency added. Hindi strings are **unreviewed by a native editor**.
- **Preparation level seeds the cold-start ability prior only** (`beginner .35 / intermediate .5 / advanced .65` in `user_features`), through the existing onboarding service; real graded evidence dominates quickly. Stored as `learner_profiles.preparation_level` (parity-tested with `PREPARATION_LEVELS`). Not a version bump of `features_v1` (initialisation value, same schema).
- **Follows now reach the ranker from the `follows` table.** The `follow` analytics event carries only `creator_id` (no content id), so the old path (`followedCreatorIds` from events) could never fire. The feed now merges the learner's own `follows` rows (read-only grant + policy for `app_server`). Official content has no user owner, so it is not followable; creator profiles/follow matter once creator content exists.
- **No quiz UI.** `quizBody` exists, but there is no server path to submit/score a quiz (`quiz_attempts` has no writer; `quiz` is not feedable). Building a client-side quiz would mean inventing a grading contract, so the app instead shows per-question grading (every answer goes through `submit-answer`) and an honest session strip. A real quiz needs a server milestone first.
- **Paged feed with small batches (6) and prefetch 3.** Answers update the learner model immediately; the next batch is ranked from it, so adaptation latency is about three cards. Pull-to-refresh _prepends_ a new batch (items already fetched are never lost, since the server marks a batch as seen when it is returned).
- **Notes open full-screen; questions answer inline.** Long note bodies cannot fit one card, so the feed shows a preview + "Read the full note" (`content_open`, then `note_open`).

## 2026-10-04 — Core learning loop decisions

- **Impressions are recorded once.** The feed records every item it serves (seen set + recency windows); the client's `feed_impression` event is stored for outcome attribution but only records an item itself on a _first sighting_ (content not served by the feed). Alternative considered: stop the feed recording at serve time — rejected, because the server must know what it served even if the client never reports it.
- **Idempotency key follows the answer, not the card.** Retrying the same answer re-sends the same key (server replays, never double-counts); a changed answer gets a new key, because the server deliberately replays the first graded attempt for a reused key. Rules live in `question-flow.ts` and are unit-tested.
- **Response time starts when the card is visible.** Cards mount early to preload; `responseMs` feeds FSRS grading, so a mount-based clock inflated it. No response time is sent if the card was never visible.
- **Language change reloads the feed after the account write.** The feed's language eligibility is read from `profiles.locale` server-side, so reloading before the write completes would fetch the old language. The UI switches immediately (optimistic); the content reloads when the preference is saved.
- **No client-side re-ranking after an answer.** Items already served are marked seen and could not be recovered if dropped, so the next batch (ranked from the updated learner model) is how an answer influences recommendations. Batch size 6 keeps that latency to roughly three cards.
- **`events` Edge Function redeployed with the fix** (it is the only function that runs `recordEvents`).
