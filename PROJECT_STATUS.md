# PROJECT_STATUS

_Last updated: 2026-10-04 (consumer mobile MVP milestone, on top of the hosted privilege-hardening milestone). Read this first; then `CLAUDE.md`; then `docs/ROADMAP.md`._

## Summary

A working, tested **foundation**: shared domain, learning + recommendation + content engines, a 16-migration Supabase schema with RLS and guard logic,
server-side services that close the learn→model→feed loop, a mobile app (bundles), an admin app (builds), Edge Function wrappers, local-AI abstraction, and a full docs set.
It is a foundation for a product, **not a finished product**: see "Not verified" and "Not built".

## Verified (by running it in this environment)

| Check                                               | Result                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` / `pnpm lint` / `prettier --check` | clean                                                                                                                                                                                                                                                                  |
| `pnpm test`                                         | **287 tests pass** across 10 workspaces (143 database, 44 mobile logic)                                                                                                                                                                                                |
| Migrations                                          | all 16 apply on PGlite **and on a real PostgreSQL 16 cluster** (concurrency suite); RLS enabled on every public table; `anon` has no privileges                                                                                                                        |
| Security / regression suites                        | 41 original security tests + `remediation` (C1, C2, H1, H2, H3, medium) + `integrity` (H4, H5, H6) + `recommendation-logging` (H9). Each audit attack has a regression test; those that exercise changed code were run against the old implementation and failed there |
| **Concurrency (H8)**                                | real multi-connection PostgreSQL 16: 12 concurrent event batches and feed/answer/event races lose no updates; **fails 3/3 without `FOR UPDATE`**; stable over 5 consecutive runs with it                                                                               |
| **Edge Functions (H7)**                             | real **Deno 2.9.6**: `deno check` + start/probe of all 5 functions (module resolution via the import map, auth gates, jobs secret). Previously `deno check` failed on extensionless imports                                                                            |
| End-to-end loop                                     | onboarding → feed → graded answer → mastery/FSRS/XP/features → next feed — now executed under the least-privileged `app_server` role                                                                                                                                   |
| Admin / Mobile builds                               | `next build` passes; `expo export --platform android` produces a Hermes bundle; the bundle contains no server-secret variable names. No service-role/DB-URL reference exists in `apps/`                                                                                |

## NOT verified (honest list)

- **Supabase CLI/Docker stack never ran.** Real GoTrue, Realtime, Storage service, PostgREST (RPC/column behaviour) and hosted-Postgres role/privilege behaviour are untested. PGlite stubs `auth.uid()`; the real-Postgres test uses the same stub, so it proves Postgres concurrency/semantics, **not Supabase**.
- **Edge Functions on the Supabase Edge Runtime** are unverified. They load and serve under real Deno, but they have never executed against a database or Supabase Auth (`getUser`), and the `postgres` driver + `SET LOCAL ROLE` path in `supabase/functions/_shared/runtime.ts` has never connected to anything.
- **Dedicated login role for `app_server` (`APP_DB_URL`)** is documented, not provisioned. Until then the privilege downgrade is a convention (see AUTHORIZATION.md). Whether `postgres` on hosted Supabase may `SET ROLE app_server` after `grant app_server to current_user` is unverified.
- **Mobile app never ran on a device/simulator**; UI, gestures, haptics, video, SecureStore adapter, NetInfo flush are unexercised; `npx expo-doctor` not run; no component/E2E tests.
- `expo install` and docs.expo.dev were blocked by the sandbox egress policy; Expo package versions come from `expo/bundledNativeModules.json` (SDK 57).
- Performance claims (low-end Android, query plans at scale, feed latency with the new row lock and candidate log writes) are design intent only; no profiling.
- Dependency vulnerability audit not run as a gate.

## Not built (by milestone — details in docs/ROADMAP.md)

Creator UI & server media finaliser (upload validation exists as functions, not wired); official-pipeline workers (fetch/extract/generate) — intentionally absent; job _scheduling_ (jobs exist and are tested; no cron configured), feature-aggregation rollups, push delivery;
comment/notification/messaging UI; creator-content profiles (a basic public profile + follow exist); push notifications; local AI runtime + model management (abstraction only); admin editor/user management/analytics dashboards; diagnostic onboarding; quiz submission contract + UI; language _preference boost_ in ranking (needs ranking_v2 + experiment); alternative-representation resurfacing;
saved_topic/adjacent/challenge/trending/related candidate sources; item-difficulty re-estimation job; content-quality improvement loop; search UI; accessibility audit on a device; captions; Hindi copy review by a native editor.

## Required human inputs / secrets (none were invented)

| Needed for                        | What                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running anything against Supabase | the hosted project's **URL** (`https://<ref>.supabase.co`, public) and anon/publishable key; then `apps/mobile/.env` with `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). Never the service-role key |
| Edge Functions                    | Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` (server only)                                                                                                                                                  |
| Staff access                      | a trusted SQL session to grant the first `admin` role (`insert into user_roles(user_id, role) values (…, 'admin')`)                                                                                                                     |
| Official publishing               | create a service user, add to `publishing_identity_members` for `ll-official`, grant `official_publisher`; its credentials live in a secrets store, never the client                                                                    |
| Real exam data                    | cited authoritative sources registered in `sources` before ingestion (seed exams are placeholders with no syllabus claims)                                                                                                              |
| Local AI                          | device benchmarks + a vetted model licence (see docs/AI_ARCHITECTURE.md decision gate)                                                                                                                                                  |
| Store releases                    | EAS/Apple/Google accounts                                                                                                                                                                                                               |

## Architecture deviations from the directive (documented in docs/DECISIONS.md)

Single `pipeline_jobs` table (not three); admin runs as the staff user (no service key); PGlite test harness instead of Docker; local-AI runtime deferred behind a decision gate.

## Known issues / watch-outs

- Mobile feed list grows within a session (no head trimming); bounded per batch (6).
- `learning_gain`/`quality_score` are computed by `aggregateContentQuality` only once it is scheduled; until then feed defaults apply.
- `pruneRawData` deletes raw events and there is no per-user rollup yet — do not schedule it before a rollup exists if long-term event history is wanted.
- `review_10` achievement defined, not awarded. `XP_CONFIG.dailyXpCap` is now enforced (see remediation).
- Interaction results are tracked as events only; they don't update mastery.
- `user_progress`/`user_achievements` are readable by any authenticated user (intentional public gamification).
- Vitest pinned to ^3.2 (5.x exists); TypeScript ~5.9 in packages (mobile template uses ~6.0).

## Consumer mobile MVP — 2026-10-04

Goal: sign-up/in → onboarding → personalised feed → open content → answer → explanation → secure learning-state update → next recommendation, in English and Hindi. Details: `docs/MOBILE_MVP.md`, decisions in `docs/DECISIONS.md`. **Not production-ready.**

### VERIFIED (run in this environment)

- `pnpm check` (typecheck + lint + **287 tests**), `prettier --check`, `expo export --platform android` (Hermes bundle, 5.6 MB; contains no server-secret names — only the client's own "refuse a service key" guard string), `next build` (admin), and all 5 Edge Functions under real **Deno 2.9.6** (`deno check` + serve/probe, 12/12) with the changed `onboarding` function.
- **Backend behaviour (PGlite, least-privileged `app_server`/`authenticated` roles):** language + preparation level through the existing onboarding path (`profiles.locale`, `learner_profiles.preparation_level`, ability prior); unsupported language/level are ignored; the service role can touch only the bound user's `locale` (column + row scope); the feed honours language as eligibility (English learners never get Hindi; Hindi learners get Hindi + English, never other languages; changing the preference changes the feed); follows reach the `followed_creator` candidate source; Hindi dev items are graded by the same server path with no key in the feed body; **mobile↔server type drift guards** (they found a real drift: the app type lacked `repeatAttempt`, now fixed and surfaced to the learner).
- **Mobile logic (Vitest, 44 tests):** i18n (every locale has every key and identical placeholders, plural pairs, fallback, locale resolution), auth validation + error mapping (no account enumeration), onboarding payload/date rules, question response/option-state modelling, session stats, answer cache, feed prepend/merge/prefetch, WCAG-AA contrast of every text colour pair (it caught and I fixed one failing green).

### NOT VERIFIED

- **Anything against the real Supabase project.** The sandbox token cannot list projects (project-scoped) and the project URL is not in the repo, so I did **not** (a) apply migration `20260102000005_mvp_language_and_level.sql` to the hosted DB, (b) redeploy the `feed`/`onboarding` Edge Functions, (c) sign up/in against real GoTrue, or (d) read the anon/publishable key. Hosted DB is therefore **one migration behind this code** and the deployed `feed`/`onboarding` functions predate it. Needed from the owner: the project URL (see "Required human inputs").
- Edge Functions on the Supabase Edge Runtime, real GoTrue email-confirmation flow (`site_url` is still localhost, so confirmation links would point at localhost), PostgREST behaviour of the new embeds (`saves → content_items`).
- Component rendering of every screen (no component/E2E tests exist; logic is tested, JSX is compiled and bundled but never rendered).

### MOCKED / SCAFFOLDED

- **Mocked:** nothing in the app is mocked at runtime. Tests use PGlite with a stubbed `auth.uid()` (as before).
- **Scaffolded / honest placeholders:** on-device AI (reports unavailable), video playback has no dev video, quiz/lesson/image/audio and matching/map **question** types show a truthful "not supported in this version" state, interactive `diagram` kind needs the media pipeline. Seed data is synthetic (6 English + 3 Hindi dev items).

### REQUIRES REAL-DEVICE TESTING

Layout on small/large phones and notches, nested scrolling inside the paged feed (card body vs. page swipe), pull-to-refresh at the top of a paged list, `expo-video` playback/mute, SecureStore session persistence across restarts, haptics, reduced-motion behaviour, Reanimated animations (entering/press/shimmer), keyboard handling on sign-in/onboarding, Hindi text rendering/wrapping and font coverage, screen-reader (TalkBack/VoiceOver) labels and touch-target sizes, offline event-queue flush, and whether the current Expo Go supports SDK 57 (otherwise an EAS development build).

### Known limits introduced by the MVP

- Language is an eligibility rule only (learner language + English); no Hindi-first boost until `ranking_v2` + an experiment.
- Hindi UI strings are unreviewed machine-authored copy; `name_i18n` exists in the schema but the seed has no Hindi names, so exam/subject chips show English until populated.
- Batch ranking marks a whole batch as seen when it is fetched (pre-existing); learning-state changes therefore reach the _next_ batch (~3 cards later), not the already-fetched ones.
- Email-confirmation projects show a "check your email" state; with `site_url=localhost` that link will not work from a phone.

## Audit remediation — 2026-10-02 (CRITICAL + HIGH done; some MEDIUM done)

Audit findings recorded 2026-10-01 were fixed in the order requested. "Regression test" = reproduces the original attack and fails on the old implementation unless noted.

| ID  | Status | Fix (files)                                                                                                                                                                                                                                                                                                       | Verified how                                                                                              |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| C1  | fixed  | `guard_member_update` trigger: membership identity fields immutable; server-assigned message timestamps (`…000001_security_remediation.sql`)                                                                                                                                                                      | regression test, fails on old schema                                                                      |
| C2  | fixed  | `app.version_hash` + gate guard + `publish_content` requires hash equality; checker ≠ author/uploader/identity member (`…000001`)                                                                                                                                                                                 | 4 regression tests (body/metadata/provenance edits, independence, hash can't be forged)                   |
| H1  | fixed  | material edits / new versions of cleared user content → `pending_review`; trusted creators keep clearance (`guard_content_update`, `publish_content`); staff creator-trust policy                                                                                                                                 | 4 tests incl. negative controls                                                                           |
| H3  | fixed  | weighted reports (account age), escalation not auto-hide for official/cleared (`on_report_insert`, `moderation_cases.escalated/priority`)                                                                                                                                                                         | 4 tests                                                                                                   |
| H2  | fixed  | `events_insert` policy and INSERT privilege removed; only the sanitising server path writes events                                                                                                                                                                                                                | regression test                                                                                           |
| H4  | fixed  | `repeatFactor`/`Evidence.scale`; repeats don't move ability/FSRS/features; 1 XP award per question+action per UTC day; `XP_CONFIG.dailyXpCap` enforced (`learning-engine`, `services/learning.ts`)                                                                                                                | 5 integration + 3 unit tests                                                                              |
| H5  | fixed  | quality job on distinct learners/viewers/weighted reporters (`jobs/index.ts`)                                                                                                                                                                                                                                     | 3 tests                                                                                                   |
| H6  | fixed* | roles `app_server`/`app_jobs` (no BYPASSRLS), explicit grants + role-scoped policies, published-only content, `asUser` binds the verified user; Edge runtime uses `SET LOCAL ROLE` (`…000002_service_roles.sql`, `sql.ts`, `_shared/runtime.ts`). *Hard barrier needs the dedicated login role (not provisioned). | 6 tests; every service test now runs under the roles                                                      |
| H8  | fixed  | `loadFeatures` = insert-if-absent + `SELECT … FOR UPDATE`, throws outside a transaction; every service runs in one transaction                                                                                                                                                                                    | real-PostgreSQL concurrency tests (fail 3/3 without the lock)                                             |
| H7  | fixed* | 67 relative specifiers made explicit (`.ts`), `allowImportingTsExtensions`; `scripts/check-edge-functions.mjs`; CI steps. *Verified under real Deno only — **not** on the Supabase Edge Runtime.                                                                                                                  | `deno check` failed before (reproduced), passes after; functions serve; tsc/Vitest/Next/Metro re-verified |
| H9  | fixed  | DB-authoritative validated ranking config (immutable once active, audited), config/feature snapshots, policy, candidate log, per-item decision + propensity, `recommendation_outcomes` view, indexes (`…000003_recommendation_logging.sql`, `feed.ts`, `rank.ts`, `config`)                                       | 9 DB tests + 4 engine + 4 config tests                                                                    |

Medium items also fixed: random public handles (no email leakage), reserved usernames, `is_creator` staff-managed, media-asset guard, moderators can't read other users' drafts, rate-limit race (advisory lock), feed `limit` NaN/negative/huge coercion, vacuous security-test assertions replaced, service role limited to published content/answer keys.

### Remaining (not fixed in this milestone)

- **MEDIUM:** mobile app calls `supabase.storage` directly (bypasses `StorageProvider`); RLS policies call `auth.uid()` per row (wrap as `(select auth.uid())` after measuring); exploration query sorts the catalogue by `md5` per request and `BASE` has correlated subqueries; per-subject ability and decay refresh only on answers; seen-set cap (500) lets content repeat; unbounded per-creator affinity map; no outbound licence/attribution display; syllabus tree is global (not per exam); `@learning-loop/database` mixes client/services/jobs/media; moderators' `analytics.read`-style cross-user views need dedicated views.
- **LOW:** unused native deps (`expo-notifications`, `expo-image`, `expo-font`, `expo-splash-screen`) _(mobile like/save initial state, the setState side effect, `session!` assertions and the fixed page-height guess were fixed in the MVP milestone)_, `appealed` state never set, admin CSP allows `'unsafe-inline'`, two TypeScript majors.
- **Design caveats introduced/kept:** XP mastery bonus can re-fire after decay (bounded by the daily cap); report weights are a heuristic (7-day / 0.2 / 3.0) pending real abuse data; propensities ignore the diversity-rejection step and exploit items have p=1 (exploration data is what makes off-policy evaluation possible); the training/evaluation job and reward definition for learned ranking are not built.

### Requires a real Supabase environment to verify

Edge Functions on the Supabase Edge Runtime (JWT verification with `getUser`, `postgres` driver, `SET LOCAL ROLE` from the platform connection, `APP_DB_URL` login role); PostgREST RPC/column behaviour of the new triggers/policies (e.g. `publish_content`, `start_direct_conversation`, view `recommendation_outcomes` with `security_invoker`); Realtime on `messages` under RLS; Storage policies; hosted Postgres 15 differences from the PG 16/17 used in tests; pg_cron scheduling of the jobs function.

## Suggested next session

0. Stand up a real Supabase environment and verify everything listed under “Requires a real Supabase environment” before building features.

1. `supabase start`, apply migrations+seed, serve functions, point the mobile app/admin at it; fix integration drift; add a Supabase-local CI job.
2. Run the mobile app on a real device; fix layout/gesture issues; add Maestro E2E for sign-up→onboarding→feed→answer.
3. Creator flow + media finaliser. 4. Scheduled workers. 5. First licensed official content via the pipeline.

## Hosted Supabase state (2026-10-04) — dedicated Learning Loop project

**Applied and verified on the hosted project (Management API + read-only catalog queries):**

- All 17 migrations are applied (history has 17 rows, last `client_privilege_hardening`). Hosted history versions are apply-time timestamps, not the repo file versions; names and order match.
- 78 public tables, RLS enabled on all 78; 31 `SECURITY DEFINER` functions all with a fixed `search_path`; private `media` bucket + 4 `media_objects_*` policies.
- `app_server`/`app_jobs`: NOLOGIN, NOINHERIT, not superuser, no BYPASSRLS, no write privilege on audit/roles/content/ranking/gates/keys/publishing/pipeline tables.
- **Hardening migration `20260102000004_client_privilege_hardening.sql` is applied.** Supabase's default ACLs had given `authenticated` TRUNCATE/REFERENCES/TRIGGER everywhere and write grants on server-written tables.
  Hosted check after apply: 0 public tables where `authenticated` holds TRUNCATE/REFERENCES/TRIGGER; 0 of the 12 learner-integrity tables (attempts, mastery, XP, features, reviews, progress, events, audit, quality signals, recommendations, stats) where it holds INSERT/UPDATE/DELETE.
  Tables with an authenticated write policy (e.g. messages, likes, profiles) keep their grants by design. New tables still get Supabase's default grants for `authenticated` (INSERT/UPDATE/DELETE) — every new table needs an explicit review.
- Edge Functions `feed`, `events`, `onboarding`, `submit-answer`, `jobs` are deployed (ACTIVE). Deployment only.

**Local only** (`pnpm check` green, 129 database tests incl. the new privilege regression test, which fails without the migration): behavioural C1/C2/H1–H9 attack tests.

**Still NOT verified on hosted:** Edge Function runtime behaviour (sandbox network blocks `*.supabase.co`); behavioural attack tests against hosted data (no DB login; SQL endpoint is read-only); Realtime authorization for messaging
(no tables in the publication); advisor warnings on executable `SECURITY DEFINER` helper functions; mobile/device testing; production-scale performance. `site_url` is still localhost and `JOBS_SECRET` is unset (deliberately).
