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
| Supabase: apply migration 000006, deploy `create-content`, turn off email confirm | **Not done.** Neither the sandbox's own token nor the one you sent works from here ("Invalid access token"); do it in the dashboard (below)       |
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

## Distribution: direct download link (decision: no Play Store)

- You build the APK once with EAS (steps above). EAS gives a **build page link**; for Android internal-distribution builds that page offers the APK download, so that link is what you share with users. (I could not verify from here whether anyone with the link can download without an Expo login — test it in a private browser window, and if not, download the APK and host it yourself, e.g. in a public Supabase Storage bucket or on your website.)
- Users must allow "install unknown apps" for their browser. Android shows a warning for apps not from Play; say so on your download page.
- **Updates are manual**: build a new APK and share a new link. Keep the same Expo account/keystore so installs upgrade in place. (`autoIncrement` is on for the production profile; the preview profile used for APKs keeps `versionCode` from `app.json` — bump it there for each release.)
- Publish the privacy policy and terms as web pages anyway (`pnpm legal:build`, host the `legal-site/` folder) and link them on your download page.
- Free Supabase projects pause after a week of inactivity and have small limits. For a public launch use the Pro plan.

## Loading your Indian History content (Khilji & Tughlaq pilot)

The pilot is **not** stored in this repository. A converter turns `questions.jsonl` + `units.jsonl` into 30 posts (28 questions in English and Hindi, plus one overview note per language); I ran it on your files and all 30 pass the server's validator. Steps (on your Mac):

1. `node scripts/history-pack.mjs <path to content/initiatives/indian_history> history-pack` → `pack.json` and `curriculum.sql`.
2. Run `history-pack/curriculum.sql` once in the Supabase SQL editor (adds the subject "Indian History", chapter "Delhi Sultanate", topic and 3 concepts; idempotent).
3. Make your account a trusted creator (SQL in "Supabase steps"), so your posts go live without waiting for approval.
4. `EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key> LL_EMAIL=… LL_PASSWORD=… node scripts/import-content-pack.mjs history-pack/pack.json` (add `--dry-run` first). It uses the same path as the app's Create screen, waits automatically at the 20-posts-per-hour limit, and resumes if interrupted.

**Do not run step 4 until you have decided these (from your own roadmap/quality report):**

- _Rights._ The pilot's text sources are marked verification-only and the licence gate rejects the proprietary course texts; your report says the "facts only" policy is **not authorised** and legal review is required. Publishing is your decision and your legal responsibility; the app's terms make the poster confirm they have the right to share.
- _Accuracy._ Dates are cross-checked against secondary sources only; no historian has reviewed them, and three exact years rest on a single source. The app has no "unreviewed" label, so learners will see this as fact.
- _Hindi._ Machine-drafted, no named native educator has reviewed it.
- _The PDF notes booklet_ is not imported: it is a 46-page designed image booklet, and it contains "what SSC asks" boxes and star ratings of exam importance, which your own pilot rules forbid without topic-level evidence. The reels (MP4) are not imported either: the creator path is text-only, and official video needs the (unbuilt) media upload and the licence gate.

## Known risks you are accepting at launch

- Content: the database has 9 synthetic sample items until you load real content (creator flow, once deployed, is how you and others add it). Curriculum is only 4 subjects / 6 concepts, so creators can only tag those; real structure must be added by an admin.
- User-generated content is moderated by you personally. Plan daily review and respond to reports quickly.
- Never tested on more than one phone, no load testing, Hindi interface text unreviewed by a native editor, no crash reporting, no push notifications.
