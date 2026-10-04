# Authorization

## Model

- **Roles** (`roles`): student, creator, moderator, admin, official_content_creator, service + service identities
  (`content_ingestion_worker`, `official_publisher`, `analytics_worker`, `moderation_worker`).
- **Permissions** (`permissions`, mapped by `role_permissions`): `content.manage_official`, `content.publish_official`, `moderation.review`, `moderation.act`,
  `users.manage`, `roles.grant`, `audit.read`, `sources.manage`, `pipeline.run`, `ranking.manage`, `experiments.manage`, `analytics.read`.
- Check with `app.has_permission(p)` (security definer; honours `expires_at`). Roles can evolve; code checks **permissions**.
- Everyone gets `student` on signup. Students can do ordinary things through _row ownership_ policies (own drafts, likes, saves, messages, reports…), not permissions.

## Who can do what (enforced in Postgres)

| Action                     | Rule                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read public content        | published, not deleted, moderation ∈ {none, cleared, pending_review}, not archived, no block between viewer and owner                                  |
| Create/edit own drafts     | owner = `auth.uid()`; ownership/owner/type/uploader/verification/moderation are server-assigned or guarded                                             |
| Publish own content        | only `publish_content()`; sets `pending_review` (or `cleared` for trusted/verified creators)                                                           |
| Author official content    | `content.manage_official` **and** membership of the publishing identity                                                                                |
| Publish official content   | `content.publish_official` + identity membership + all 7 gates passed + provenance + rate limit; stamps `verification='official'`; audited; idempotent |
| Write gate results / jobs  | `pipeline.run` (not granted to authoring roles)                                                                                                        |
| Moderate                   | `moderation.act` via `apply_moderation_action()` only (content state cannot be changed directly)                                                       |
| Grant roles                | `roles.grant`, audited; self-grant impossible                                                                                                          |
| Learner state              | read own only; **no client writes** (server path)                                                                                                      |
| Recommendation diagnostics | `analytics.read`                                                                                                                                       |
| Messaging                  | start via `start_direct_conversation()` (blocks, `dm_policy`, restrictions); members only read/send; messages immutable (soft delete)                  |

## Service identities

Non-human actors are ordinary auth users with a service role and, for publishing, membership in a `kind='service'` publishing identity.
They authenticate with their own JWT and are bound by the same RLS — **they do not use the service-role key**. Rotating/revoking = delete the role row or user.
**Server-side code is least-privileged (audit H6).** Edge Functions derive `userId` from a verified JWT, then run every transaction as `SET LOCAL ROLE app_server` (or `app_jobs` for scheduled jobs) with `request.jwt.claim.sub` bound to that user (`asUser`). These roles are **not superusers and have no `BYPASSRLS`**; they hold explicit table grants + role-scoped policies (migration `20260102000002_service_roles.sql`) and can read only _published_ content and answer keys. They cannot write roles/permissions, content, moderation, audit, sources, pipeline jobs or publishing identities (tested). Guard triggers therefore apply to them too; only the derived learner fields explicitly allow `app_server`.
Residual risk (honest): when the Edge runtime connects with the platform's `postgres` URL, application code can still _choose_ to `SET ROLE` back — the downgrade is a convention, not a hard barrier. The hard barrier is a dedicated login role that is only a member of `app_server`/`app_jobs` (`APP_DB_URL`); creating it needs a password set out-of-band (not verified here, no Supabase environment).

## Verified by tests (`packages/database/test/security.test.ts`)

privilege escalation (self role grant, moderator grant), cross-user profile edit, `account_state` change, creator trust self-assignment, ownership forgery, direct publish,
verification/moderation tampering, editing others' content, published-version immutability, answer-key visibility, official authoring/publishing without identity or gates, author forging gates,
report impersonation/dup, moderation function permission, audit append-only, block visibility & messaging bypass, rate limits, learner-state forging, event spoofing, staff-only diagnostics/sources/pipeline, storage path scoping.

## Remediation of the 2026-10-01 audit (what changed in the guarantees)

| Finding | Guarantee now (all with regression tests)                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1      | `conversation_members.conversation_id/user_id/member_role` are immutable for end users (guard trigger); message timestamps are server-assigned                                                                                                                                                                                                                                            |
| C2      | `quality_gate_results.content_hash` is **assigned by the database** (`app.version_hash`: body, answer key, provenance + source licence snapshots, metadata, concept/exam links). `publish_content` requires every gate to match the _current_ hash, so any edit after validation fails closed until re-validated. A gate checker cannot be the content's author/uploader/identity member. |
| H1      | Material edits (title/summary/language/hook/format/objective) or a new published version of `cleared` user content return it to `pending_review` (trusted/verified creators keep clearance on new versions)                                                                                                                                                                               |
| H2      | No client INSERT policy or privilege on `events`; only the sanitising server path (`app_server`) writes events                                                                                                                                                                                                                                                                            |
| H3      | Reports are weighted server-side (accounts < 7 days old count 0.2); 3.0 total weight auto-flags only **non-official** content that is not already human-cleared; official/cleared content raises `moderation_cases.priority`/`escalated` for a human instead                                                                                                                              |
| Medium  | random public handles (no email leakage), reserved usernames and `is_creator` staff-managed, media rows confined to the owner's key prefix and own content, moderators can no longer read other users' drafts, rate-limit check serialised by advisory lock, staff policy for creator trust                                                                                               |

## Client privilege layer (2026-10-04)

Policies alone were not the whole story on Supabase: default ACLs grant `authenticated` ALL on new public tables. Migration `20260102000004_client_privilege_hardening.sql` (applied to hosted, tested locally) removes
TRUNCATE/REFERENCES/TRIGGER from `authenticated` everywhere and INSERT/UPDATE/DELETE from every table that has no authenticated/public write policy. Verified on hosted by catalog queries (no tables left with those privileges
among the learner-integrity set). Behavioural hosted attack tests remain unverified; any new table still inherits default grants until reviewed.
