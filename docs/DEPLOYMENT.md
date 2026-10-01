# Deployment & environments

Environments: `development` (local Supabase CLI + seed), `test` (PGlite in CI), `production` (hosted Supabase project; migrations applied by CI/CLI; **never run `seed.sql` in production**).

## Local stack (requires Docker + Supabase CLI — _not available in the authoring sandbox, so these steps are unverified_)

```bash
supabase start                 # prints API URL + anon key
supabase db reset              # migrations + supabase/seed/seed.sql (synthetic data)
supabase functions serve --env-file ./supabase/.env.local   # Deno import map: supabase/functions/deno.json
```

Create dev users via the Auth API or Studio; grant staff roles from a trusted SQL session (`insert into user_roles …`) — never from the client.
Official publishing identity for dev: seeded `ll-official` (service kind); add a service user to `publishing_identity_members` and give it `official_content_creator`/`official_publisher`.

## Release checklist

1. `pnpm check` + CI builds green. 2. `supabase db push` (migrations only). 3. Deploy functions (`supabase functions deploy submit-answer feed events onboarding`) with secrets set in Supabase. 4. Admin: set `NEXT_PUBLIC_*` only. 5. Mobile: EAS build with `EXPO_PUBLIC_*` only.
   Verify post-deploy: RLS smoke test as a normal user (cannot read others' drafts/learning rows), anon has no table access, bucket is private.

## Mobile builds

Expo SDK 57 / RN 0.86 (New Architecture). Use EAS (`eas build`) for dev/production builds; native modules added later (e.g. llama.rn) require a development build. `app.json` scheme `learningloop`.
Sandbox note: `expo install`/docs.expo.dev were blocked by egress policy; versions were pinned from `bundledNativeModules.json`. `npx expo-doctor` has not been run — run it on a networked machine.

## Cost posture

Free tiers first (Supabase, Vercel/Netlify for admin), no paid AI, Storage via Supabase until volume justifies R2 behind `StorageProvider`.
