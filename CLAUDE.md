# CLAUDE.md — permanent engineering instructions for Learning Loop

Read `PROJECT_STATUS.md` first (what exists, what is unverified, what is next). Detailed specs live in `docs/`; this file holds only
constraints that must never be forgotten. The repository is the single source of truth — put decisions in `docs/DECISIONS.md`, not in chat.

## Product north star

More usage → better learner model → better recommendations → more learning. Optimise **learning**, never raw screen time/swipes/notifications.
No dark patterns: no false urgency, deceptive exits, misleading notifications, withheld rewards. Passive watching earns no XP.

## Commands

```bash
pnpm install
pnpm check                 # typecheck + lint + tests (run before every commit)
pnpm --filter @learning-loop/database test   # migrations + RLS + parity + end-to-end loop (PGlite, ~1 min)
pnpm --filter @learning-loop/admin build
pnpm --filter @learning-loop/mobile exec expo export --platform android   # Metro bundle check (EXPO_OFFLINE=1 CI=1)
node scripts/check-edge-functions.mjs   # deno check + serve/probe Edge Functions (DENO=… REQUIRE_DENO=1 in CI)
REQUIRE_REAL_PG=1 pnpm --filter @learning-loop/database test concurrency   # real-PostgreSQL concurrency test
pnpm format                # prettier
```

## Architecture rules

- Modular monolith. No microservices. Domain logic lives in pure, tested packages; UI/Edge code stays thin.
- `packages/*` are consumed as TypeScript source (`main: src/index.ts`). Mobile must import `@learning-loop/database/client` ONLY
  (the package root imports `node:crypto`; it is server-only). Likewise `@learning-loop/learning-engine/gamification` in the app.
- All schema changes are new migration files in `supabase/migrations/` (never edit an applied migration's meaning once shipped;
  while pre-release, edit in place and keep tests green). No dashboard-only changes.
- SQL enums ↔ `packages/shared` constants, rate limits ↔ `packages/config`, required gates ↔ `content-engine`: parity is tested
  (`packages/database/test/parity.test.ts`). Change both sides together.
- Relative imports in `packages/*/src` use explicit `.ts` extensions (Deno resolves nothing else). Keep them (`allowImportingTsExtensions`).
- Ranking configuration is authoritative in `ranking_versions.algorithm` (validated by `parseRankingConfig`, immutable once active); code `RANKING_V1` is seed/fallback only and parity-tested.
- Everything important is versioned: `ranking_vN`, `mastery_v1`, `fsrs_v1`, `features_v1`, `content_schema_v1`, `difficulty_v1`.
  Algorithm changes = new version + (for ranking) an experiment record. Never change behaviour silently.
- Prefer a maintained library for infrastructure; record it in `docs/THIRD_PARTY.md` (license, why, limits). No dependency bloat.
- Expo: do not trust memory. Check `node_modules/expo/bundledNativeModules.json` for SDK-compatible versions; docs at
  `https://docs.expo.dev/versions/v<major>.0.0/` (may be blocked in sandboxes — then say so, don't guess).

## Security rules (non-negotiable)

1. Authorization is enforced in Postgres (RLS, guard triggers, `SECURITY DEFINER` functions with fixed `search_path`). Never rely on `if (role === …)` in a client.
2. Service-role/DB credentials exist only in server runtimes (Edge Functions, CI). Only `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` anon values reach clients;
   `createPublicClient` refuses service keys. Never commit secrets; `.env.example` has placeholders only.
3. Learner integrity: attempts, mastery, reviews, XP, features **and analytics events** are written only by server paths (`submitAnswer`, `recordEvents`).
   Clients have no write policy or privilege on them. Raw client events never create mastery evidence. Repeats of an answered question are discounted (`repeatFactor`), XP is capped per question/day and per day; quality signals count distinct learners, never raw attempts.
4. Answer keys/explanations live in `content_answer_keys` (not in the public body); question bodies containing `answer`/`explanation` are rejected.
5. Official content: only via `publish_content()` with identity membership + all quality gates + provenance. Gates are bound to a DB-computed `content_hash` (stale after any edit) and the checker can never be the author; authors never hold `pipeline.run`.
   5b. Server code (Edge Functions, jobs) runs as the non-superuser, no-BYPASSRLS roles `app_server`/`app_jobs` via `SET LOCAL ROLE` inside one transaction (`asUser`). When a service needs a new table, add an explicit grant + role-scoped policy in a migration and a test — never use a privileged role. Learner features are updated only under `FOR UPDATE` (`loadFeatures` throws outside a transaction).
6. Privileged actions write `audit_log` (append-only). Source term changes are audited automatically.
7. No "official" via username checks. Official = `ownership='official'` + `publishing_identity_id` + permission + membership.
8. Analytics payloads: only taxonomy-declared keys, primitives only; never tokens, emails, message text.

## Content & rights

- _Access ≠ reuse._ Use `evaluateLicense/evaluateSources`; unknown/unclear → `flag_for_review`; NC/ND/proprietary rejected for our use.
- Never bypass paywalls/auth/technical restrictions; never mass-copy copyrighted material.
- Do not fabricate syllabus/exam-pattern facts. Seed data is synthetic and labelled; real exam data needs cited authoritative sources.
- Provenance is never discarded (versions are immutable once published; license terms are snapshotted per derivation).

## AI rules

Runtime AI is local/on-device only. No paid cloud API on a runtime path. No fake AI: if inference can't run, show the truthful unavailable state
(`AIService` throws `AIUnavailableError`; UI must display `availability().detail`).

## Testing expectations

Unit tests for engines; PGlite-backed tests for migrations/RLS/privilege-escalation/loop; every new table needs RLS enabled
(`migrations.test.ts` fails otherwise) and a security test for any new write path. Test behaviour that matters, not coverage numbers.

## Style

Match surrounding code. Small commits with `feat:/fix:/docs:/test:` prefixes. Never force-push. Update `PROJECT_STATUS.md` and relevant docs at the end of each milestone.
