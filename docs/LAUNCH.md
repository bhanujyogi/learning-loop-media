# Launch guide (target: public launch 19 Oct 2026)

Status of each launch gate. "Built" = code + tests exist here; "Needs owner" = a person must do it (accounts, legal facts, dashboard clicks).

| Gate                                                                              | Status                                                                                                                                            |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up / sign-in / onboarding / feed / answers / social                          | Built; auth + onboarding smoke-tested on a real phone by the owner                                                                                |
| Creator upload (note, flashcard, question; English + Hindi)                       | **Built, test-verified only** (service, validation, UI). Not yet deployed to the hosted project, never run on a phone                             |
| Review before others see posts (pre-moderation)                                   | **Built** (migration 000006). Needs someone to approve posts — see "Moderating"                                                                   |
| Report post / report user / block user                                            | **Built** (UI + existing tables); moderators act through the admin app                                                                            |
| In-app account deletion                                                           | **Built** (`delete_my_account()`, tested); needs hosted migration                                                                                 |
| Privacy policy, Terms, Community guidelines (in app + static web pages)           | **Drafted**, not legal advice. **Needs owner:** operator name, contact email, governing law (`apps/mobile/src/legal/operator.json`), and a review |
| App icon/splash, permissions minimised, build profiles                            | Built (icon is a generated placeholder mark; replace with your brand when you have it)                                                            |
| Android build                                                                     | **Needs owner:** an Expo account and 3 commands on your Mac (below)                                                                               |
| Supabase: apply migration 000006, deploy `create-content`, turn off email confirm | **Needs a valid Supabase access token for me, or the owner** (below). My earlier token now returns "Invalid access token"                         |
| Google Play listing                                                               | **Needs owner** — see "Play Store reality check"                                                                                                  |

## Build the Android app (on your Mac)

1. Create a free account at https://expo.dev and note your username.
2. In Terminal (Node.js 20+ installed):
   ```
   git clone https://github.com/bhanujyogi/learning-loop-media.git   # skip if you already have it
   cd learning-loop-media && git checkout claude/lucid-lovelace-gkvaue && pnpm install
   cd apps/mobile
   npx eas-cli@latest login
   npx eas-cli@latest init            # answer yes; it adds a projectId to app.json — commit/push that change
   npx eas-cli@latest build -p android --profile preview
   ```
   When asked about an Android keystore choose "Generate new keystore" (EAS stores it; **do not lose access to this Expo account** — it is the identity of your app for updates).
3. After ~10–20 minutes you get a link to an **APK**. Open it on an Android phone (allow "install unknown apps" for your browser) or share the link.
4. For the Play Store later use `--profile production` (an AAB).

Before building run `pnpm release:check` in the repo root — it refuses to pass while legal details are placeholders, a secret is committed, or the build profile holds anything but the public Supabase URL and publishable key.

## Supabase steps (hosted project `qwgsabpiqexfhndojckv`)

If you give me a fresh project-scoped access token I do these myself; otherwise, in the dashboard:

1. **SQL editor → paste and run** `supabase/migrations/20260102000006_ugc_launch_safety.sql` (pre-moderation + account deletion).
2. **Edge functions**: deploy `create-content` (`supabase functions deploy create-content` with the CLI), and redeploy `feed` and `submit-answer` (they now require approved content).
3. **Authentication → Providers → Email → turn off "Confirm email"** (agreed for the test launch).
4. **Make yourself an admin and trusted creator** (SQL editor; replace the email):
   ```sql
   insert into user_roles(user_id, role) select id, 'admin' from auth.users where email = 'YOU@example.com' on conflict do nothing;
   insert into user_roles(user_id, role) select id, 'moderator' from auth.users where email = 'YOU@example.com' on conflict do nothing;
   insert into creator_profiles(user_id, trust_level) select id, 'trusted' from auth.users where email = 'YOU@example.com'
     on conflict (user_id) do update set trust_level = 'trusted';
   ```
   A trusted creator's posts go live immediately; everyone else's wait for approval.

## Moderating

- Posts from non-trusted creators are visible only to their author until a moderator approves them.
- Approving/removing is meant to happen in the **admin web app** (`apps/admin`, builds today). It is **not deployed anywhere yet** — deploying it (Netlify/Vercel, public values only) is an open task.
- Until then, approve from the Supabase SQL editor (it runs with full database rights, so it bypasses the audited moderation function — acceptable for launch week, but there will be no audit-log entry):
  ```sql
  -- see what is waiting
  select id, title, type, created_at from content_items where moderation = 'pending_review' and publishing = 'published' order by created_at;
  -- approve one
  update content_items set moderation = 'cleared' where id = '<content-id>';
  -- remove one
  update content_items set moderation = 'removed' where id = '<content-id>';
  ```
  Reports waiting for you: `select * from reports where status = 'open' order by created_at;`
- To make a reliable creator trusted: `update creator_profiles set trust_level = 'trusted' where user_id = '<id>'`.

## Play Store reality check

- A Play Console developer account costs a one-time fee and needs identity verification. **Personal accounts created recently must usually run a closed test with a minimum number of testers for about two weeks before they may publish publicly** (policy as I know it; confirm in the console, it changes). That alone means a Play-Store public launch on 19 Oct is unlikely unless your account already qualifies or is an organisation account.
- A realistic 19 Oct public launch is therefore: **APK download link + the legal web pages**, with the Play listing following. Play also requires a public privacy-policy URL (use `pnpm legal:build`, then host the `legal-site/` folder), a data-safety form, content rating, screenshots, and an in-app account-deletion path (built) plus a web deletion-request page for the listing.
- Free Supabase projects pause after a week of inactivity and have small limits. For a public launch use the Pro plan.

## Known risks you are accepting at launch

- Content: the database has 9 synthetic sample items until you load real content (creator flow, once deployed, is how you and others add it). Curriculum is only 4 subjects / 6 concepts, so creators can only tag those; real structure must be added by an admin.
- User-generated content is moderated by you personally. Plan daily review and respond to reports quickly.
- Never tested on more than one phone, no load testing, Hindi interface text unreviewed by a native editor, no crash reporting, no push notifications.
