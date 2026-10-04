# Consumer mobile MVP

The first usable end-to-end learner journey on top of the existing foundation (no backend redesign):

```
sign up / sign in → onboarding → personalised feed → open content → answer → explanation
        → secure learning-state update → next recommendation
```

> **Status: code-complete and test-verified; never run on a device or simulator.** See `PROJECT_STATUS.md` for the verified / not-verified split.

## What each step uses (all existing paths)

| Step                 | Client                                                                                         | Server / DB                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Auth                 | `supabase.auth` (public anon/publishable key only), SecureStore session, `lib/auth-validation` | Supabase Auth; profile row created by trigger                                                                  |
| Routing gate         | `app/_layout.tsx` + `lib/account.ts` (UX only)                                                 | Authorization is RLS/Edge, never the redirect                                                                  |
| Onboarding (5 steps) | `app/onboarding.tsx`, `lib/onboarding.ts`                                                      | `onboarding` Edge Function → `completeOnboarding` (locale, level prior, exam, interests, date)                 |
| Feed                 | `features/feed/*`, `lib/use-feed.ts` (appends/prepends only — **never re-ranks**)              | `feed` Edge Function → `getFeed` → `rankFeed`; DB-authoritative `ranking_versions`; H9 candidate/decision logs |
| Answer               | `features/feed/QuestionCard.tsx` (idempotency key, double-submit guard)                        | `submit-answer` → `submitAnswer` (grading, mastery, FSRS, XP, features) — the client holds no answer key       |
| Engagement signals   | `lib/event-queue.ts` (offline queue) → `events`                                                | `recordEvents`: sanitised, engagement only; **learning events cannot create mastery**                          |
| Like / save / follow | `lib/use-reactions.ts` (optimistic, rolls back)                                                | RLS-protected `likes`/`saves`/`follows`; follows also feed the `followed_creator` candidate source             |
| Profile / Saved      | `(tabs)/profile.tsx`, `saved.tsx`, `user/[id].tsx`, `content/[id].tsx`                         | RLS (own rows; public profile fields)                                                                          |

## Language (English + Hindi)

- The preference is `profiles.locale` (one place). UI strings live in `src/i18n/{en,hi}.ts` (typed; Hindi must have every key; tested). Content is never translated at runtime: each item has its own `language`, curriculum rows have `name_i18n`.
- The feed serves the learner's language **plus English** (eligibility rule). See `docs/DECISIONS.md` (2026-10-04).
- Adding a language: add its code to `SUPPORTED_LOCALES` (`packages/shared`), a catalogue file, one line in `i18n/core.ts`, and its endonym in `ui/LanguageSwitch.tsx`.
- **Hindi UI text was written for this MVP and has not been reviewed by a native-speaker editor.**

## Content types in the feed

| Type                                               | Rendering                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| question (8 subtypes)                              | inline; server-graded; correct/wrong/missed states + explanation                   |
| note                                               | preview card → full-screen viewer                                                  |
| flashcard                                          | flip card                                                                          |
| video                                              | `expo-video`, signed URL from the private bucket (no dev video yet)                |
| interactive                                        | data-driven renderer (tap-reveal, ordering, matching, timeline, map)               |
| quiz, lesson, image, audio, matching/map questions | truthful "not supported in this version" — **no quiz contract exists server-side** |

## Running it (needs a person at a keyboard — nothing here has been run on a device)

1. A Supabase project with all migrations applied (including `20260102000005_mvp_language_and_level.sql`) and the Edge Functions deployed from this commit (done for the hosted project; see PROJECT_STATUS.md).
2. Create `apps/mobile/.env` (never commit it) with the **public** values only:
   `EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co` and `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or sb_publishable_… key>`.
   The app refuses a service-role key by design.
3. `pnpm install`, then `pnpm --filter @learning-loop/mobile start`, and open it on a phone/emulator. Whether the current store build of Expo Go supports SDK 57 is **unverified**; if it doesn't, make a development build with EAS.
4. For development data only, apply `supabase/seed/seed.sql` (synthetic, English + 3 Hindi items). **Never seed production.**

## Core learning loop (second milestone)

```
feed (ranked batch, recommendation id) → card visible (timer starts) → answer → submit-answer (idempotent, server-graded)
   → result + explanation + XP + mastery estimate → recommendation outcome (server-written learning events)
   → engagement events (impression/like/save/open, client → events) → next batch ranked from the updated learner model
```

- **Learning vs engagement stay separate.** Only `submit-answer` can change mastery/XP/ability/FSRS; `events` accepts engagement signals and ignores learning-type events for learning state. Both carry the `recommendation_id`, so `recommendation_outcomes` joins them per (user, recommendation, item).
- **Question rules** (`features/feed/question-flow.ts`, pure + tested): double-tap safe; retry keeps the idempotency key unless the answer changed; response time measured from visibility; results survive scrolling away (`answer-cache`).
- **Feed rules** (`lib/feed-state.ts`): append on scroll, prepend on refresh, never re-sort; reset on language change; stale responses dropped.
- **Social** (`lib/use-reactions.ts`): initial state from the database; optimistic toggles roll back on real failures; duplicate-row = already on; saves refresh Saved + profile count.
