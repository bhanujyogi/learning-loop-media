# HANDOFF — read this first in a new Claude Code session

Learning Loop: Expo/React Native app (`apps/mobile`) + Supabase backend (`supabase/`), pnpm monorepo. Also read `CLAUDE.md` (permanent rules)
and `PROJECT_STATUS.md` (what is verified / not). Owner is non-technical: explain in simple words, do the work yourself.

## Where things are
- Branch with all current work: `claude/lucid-lovelace-gkvaue` (GitHub: bhanujyogi/learning-loop-media, PUBLIC repo). `main` does not have it yet. No PR was created.
- Supabase project ref `qwgsabpiqexfhndojckv` (dedicated Learning Loop project). Only the public URL + publishable key are in the app
  (`apps/mobile/eas.json`, `.github/workflows/android-apk.yml`). Never put service-role keys, tokens or passwords in the repo or the app.
- Owner account in the app: bhanuzyogi@gmail.com (trusted creator). Email confirmation is OFF in Supabase.

## Commands
`pnpm install`, `pnpm check` (typecheck+lint+tests, run before every commit), `pnpm format`,
`node scripts/check-release.mjs`, `DENO=<path> REQUIRE_DENO=1 node scripts/check-edge-functions.mjs`.

## Building the Android APK (no Play Store, no Expo account)
Push to the branch -> GitHub Action "Android APK" (`.github/workflows/android-apk.yml`) builds a signed APK (~20 min) and publishes a
GitHub Release (`apk-N`, file `learning-loop.apk`). Signing key is generated once and kept in the Actions cache (add repo secrets
ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS before the public launch so updates keep the same key).
The build needs the 6 GB Gradle heap settings already in the workflow.

## Changing the live backend (Supabase)
- Use the Supabase connector (MCP tools: apply_migration, execute_sql, deploy_edge_function, query_logs). The owner connects it at
  claude.ai -> Settings -> Connectors. Tokens pasted in chat never worked; do not ask for them.
- Migrations live in `supabase/migrations/` (all applied to the live project up to 000012). New schema = new migration file + apply it.
  Server roles (`app_server`, `app_jobs`) cannot use Supabase's `auth` schema: use `app.uid()` instead of `auth.uid()`.
- The tool wrapper silently hangs (60 s timeout) on SQL text containing `delete from` / `drop`; build those statements dynamically
  (e.g. `'del' || 'ete from ...'` inside `execute`) or avoid them.
- Edge Functions are deployed with `deploy_edge_function` as a tiny `index.ts` that imports the function from a PINNED commit on raw.githubusercontent.com,
  plus a `deno.json` import map pointing `@learning-loop/*` at the same commit (see git history of this file's author for the pattern; the
  five functions: feed, events, onboarding, submit-answer, create-content). Push first, then deploy with the new commit SHA.
- Logs: `query_logs` with `select ... from logs where source in ('function_logs','function_edge_logs')`.

## Product decisions already made (do not re-ask)
Open publishing (no approval), reports can flag non-trusted creators' posts; free-text topics; instant tap-to-answer MCQ with the answer
hash sent to the phone (docs/DECISIONS.md 2026-10-18); in-app bulk import (questions, picture flashcards, images, videos; `bulk-upload/` has prompts+templates);
Instagram-style UI; friends/groups/chat; watch-time (dwell) feed signals; English + Hindi.

## Open items
Real-phone testing of everything (nothing was run on a device); comments UI, stories, full-screen image zoom, realtime chat, follower counts on
other profiles; legal text review (privacy/terms are drafts); Hindi UI review by a native speaker; add the signing-key secrets; admin/moderation UI.
