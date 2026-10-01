# PROJECT_STATUS

_Last updated: 2026-10-01 (session 1). Read this first; then `CLAUDE.md`; then `docs/ROADMAP.md`._

## Summary

A working, tested **foundation**: shared domain, learning + recommendation + content engines, a 13-migration Supabase schema with RLS and guard logic,
server-side services that close the learn→model→feed loop, a mobile app (bundles), an admin app (builds), Edge Function wrappers, local-AI abstraction, and a full docs set.
It is a foundation for a product, **not a finished product**: see "Not verified" and "Not built".

## Verified (by running it in this environment)

| Check                                          | Result                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` / `pnpm lint`                 | clean                                                                                                                                                                                                          |
| `pnpm test`                                    | 177 tests pass across 9 workspaces                                                                                                                                                                             |
| Migrations on real Postgres semantics (PGlite) | all 13 apply; RLS enabled on every public table; anon has no privileges                                                                                                                                        |
| Security suite                                 | ~40 scenarios incl. privilege escalation, ownership forgery, direct publish, answer-key access, official-publish gating, gate forgery, moderation, blocks/messaging bypass, rate limits, learner-state forging |
| End-to-end loop (`database/test/loop.test.ts`) | onboarding → feed → graded answer → mastery/FSRS/XP/features → next feed prioritises weak concept; idempotent; events can't forge mastery                                                                      |
| Admin                                          | `next build` succeeds (11 routes)                                                                                                                                                                              |
| Mobile                                         | `tsc` clean; `expo export --platform android` produces a Hermes bundle (Metro resolves the pnpm workspace); logic tests pass                                                                                   |

## NOT verified (honest list)

- **Supabase CLI/Docker stack never ran** (not available in the sandbox). Real GoTrue, Realtime, Storage service, PostgREST column/RPC behaviour are untested; the PGlite harness stubs `auth.uid()` and `storage`.
- **Edge Functions (`supabase/functions/*`, including `jobs`) never executed** (no Deno). They are thin; the logic they call is tested. Import-map paths and `postgres` driver wiring may need adjustment.
- **Mobile app never ran on a device/simulator**; UI, gestures, haptics, video playback, SecureStore adapter, NetInfo flush, safe-area layout are unexercised. `npx expo-doctor` not run. No component/E2E tests.
- `expo install` and docs.expo.dev were blocked by the sandbox egress policy; Expo package versions were taken from `expo/bundledNativeModules.json` (SDK 57).
- Performance claims (low-end Android, query plans at scale, feed latency) are **design intent only**; no profiling yet.
- Dependency vulnerability audit not run as a gate.

## Not built (by milestone — details in docs/ROADMAP.md)

Creator UI & server media finaliser (upload validation exists as functions, not wired); official-pipeline workers (fetch/extract/generate) — intentionally absent; job _scheduling_ (jobs exist and are tested; no cron configured), feature-aggregation rollups, push delivery;
profiles/follow/comment/notification/messaging UI; push notifications; local AI runtime + model management (abstraction only); admin editor/user management/analytics dashboards; diagnostic onboarding; alternative-representation resurfacing;
saved_topic/adjacent/challenge/trending/related candidate sources; item-difficulty re-estimation job; content-quality improvement loop; search UI; i18n UI; accessibility audit; captions.

## Required human inputs / secrets (none were invented)

| Needed for                        | What                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running anything against Supabase | a Supabase project or local CLI stack; then `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_*` (see `.env.example`)                        |
| Edge Functions                    | Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` (server only)                                                                               |
| Staff access                      | a trusted SQL session to grant the first `admin` role (`insert into user_roles(user_id, role) values (…, 'admin')`)                                                  |
| Official publishing               | create a service user, add to `publishing_identity_members` for `ll-official`, grant `official_publisher`; its credentials live in a secrets store, never the client |
| Real exam data                    | cited authoritative sources registered in `sources` before ingestion (seed exams are placeholders with no syllabus claims)                                           |
| Local AI                          | device benchmarks + a vetted model licence (see docs/AI_ARCHITECTURE.md decision gate)                                                                               |
| Store releases                    | EAS/Apple/Google accounts                                                                                                                                            |

## Architecture deviations from the directive (documented in docs/DECISIONS.md)

Single `pipeline_jobs` table (not three); admin runs as the staff user (no service key); PGlite test harness instead of Docker; local-AI runtime deferred behind a decision gate.

## Known issues / watch-outs

- Mobile feed list grows within a session (no head trimming); bounded per batch.
- `learning_gain`/`quality_score` are computed by `aggregateContentQuality` only once it is scheduled; until then feed defaults apply.
- `pruneRawData` deletes raw events and there is no per-user rollup yet — do not schedule it before a rollup exists if long-term event history is wanted.
- `review_10` achievement defined, not awarded. `dailyXpCapForRepeatActions` configured, not enforced.
- Interaction results are tracked as events only; they don't update mastery.
- `user_progress`/`user_achievements` are readable by any authenticated user (intentional public gamification).
- Vitest pinned to ^3.2 (5.x exists); TypeScript ~5.9 in packages (mobile template uses ~6.0).

## Architectural & security audit — 2026-10-01 (completed; remediation NOT started)

**Do not build new features until the CRITICAL/HIGH items below are fixed.** P# = reproduced with a throwaway PGlite probe (not committed).

CRITICAL

- C1 (P1) `conversation_members` update policy lets a member move their row's `conversation_id` into any conversation and read its DMs (`20260101000010_messaging.sql`).
- C2 (P2) An official draft's body, answer key or provenance can be edited after the quality gates pass, and still publishes. Gate results aren't tied to a content hash (`…05_content_security.sql`, `…06`).

HIGH

- H1 (P3) A new version or a title/summary edit on `cleared` user content stays `cleared`, which bypasses moderation (`publish_content`, content update guard).
- H2 (P4) Direct PostgREST `events` inserts bypass the taxonomy sanitiser. They allow arbitrary payload/PII and forged skip/save events that feed `aggregateContentQuality` and the ranking quality score.
- H3 (P5) Three throwaway accounts can auto-hide any content, including official content (`on_report_insert`).
- H4 (P6) XP farming and mastery inflation: `submitAnswer` gives unlimited re-attempts, reveals the answer, has no per-question/day cap, and `dailyXpCap` isn't enforced.
- H5 (P7) One user can flag content `needs_revision`, because quality thresholds count attempts and events instead of distinct learners (`jobs/index.ts`).
- H6 Edge Functions run on a privileged DB connection where every guard is skipped (`auth.uid() is null`). This contradicts AUTHORIZATION.md. A dedicated least-privilege DB role is needed.
- H7 (inferred) Edge Functions likely fail to resolve in Deno: workspace packages use extensionless relative imports and paths outside `supabase/functions`.
- H8 (inferred) `user_features` uses a read-modify-write of one JSON blob with no row lock (`getFeed` isn't even in a transaction), so concurrent feed/answer/events requests lose updates.
- H9 Recommendation logs can't support off-policy learning or bandits: there is no propensity, no logged candidate set or feature vector, and outcome events don't carry `recommendation_id`. `ranking_versions.algorithm` is ignored (weights come from code).

MEDIUM

- (P8) Username is derived from the email local-part and is public (PII). Users can self-set confusable usernames and `is_creator`.
- (P9) Members can self-set `member_role='admin'` (latent group-chat escalation). Senders can rewrite `created_at`.
- (P10) `moderation.review` can read every private draft.
- (P11) Clients can create `media_assets` rows pointing at another user's storage key or another user's content. The future finaliser must verify this.
- The mobile app calls `supabase.storage` directly, which bypasses `StorageProvider`.
- The same identity can both author and gate content: `quality_gate_results.checked_by` is unused and unenforced.
- No attribution display and no outbound licence (CC BY-SA) on content.
- Learner ability is a single global scalar, and concept needs/decay are only refreshed on answer.
- Seen-set cap of 500 brings content back. Creator affinity map is unbounded.
- Exploration query sorts the whole catalogue by `md5` per request, and `BASE` has correlated subqueries per row. RLS calls `auth.uid()` per row without the `(select …)` wrapper.
- The quality job scans `events.payload->>'content_id'` with no index.
- Syllabus trees aren't per-exam (each concept sits under exactly one global topic).
- The `@learning-loop/database` package mixes client, services, jobs and media.
- Docs overstate integrity guarantees (AUTHORIZATION/ANALYTICS/learner-integrity claims).

LOW

- Feed `limit` set to non-numeric gives NaN, which returns an empty feed.
- Mobile: the like/save initial state isn't loaded, there's a side effect inside a setState updater, `session!` assertions, a guessed fixed page height, and no scrolling inside cards.
- Unused native dependencies (`expo-notifications`, `expo-image`, `expo-font`, `expo-splash-screen`).
- 4 vacuous test assertions (`.catch(() => undefined)` / `Actor.prototype` in `security.test.ts`).
- Rate-limit count-then-insert race. Admin CSP allows `'unsafe-inline'`. `appealed` state is never set. Two TypeScript majors (5.9 / 6.0).

Remediation order: C1 → C2 → H1 → H3 → H2 → H4/H5 → H6 → H8 → H7 (verify on a real Supabase CLI) → H9 → MEDIUM → LOW. Add a regression test for each probe.

## Suggested next session

0. **Remediate the audit findings above first (CRITICAL → HIGH), each with a regression test.**

1. `supabase start`, apply migrations+seed, serve functions, point the mobile app/admin at it; fix integration drift; add a Supabase-local CI job.
2. Run the mobile app on a real device; fix layout/gesture issues; add Maestro E2E for sign-up→onboarding→feed→answer.
3. Creator flow + media finaliser. 4. Scheduled workers. 5. First licensed official content via the pipeline.
