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

## Suggested next session

1. `supabase start`, apply migrations+seed, serve functions, point the mobile app/admin at it; fix integration drift; add a Supabase-local CI job.
2. Run the mobile app on a real device; fix layout/gesture issues; add Maestro E2E for sign-up→onboarding→feed→answer.
3. Creator flow + media finaliser. 4. Scheduled workers. 5. First licensed official content via the pipeline.
