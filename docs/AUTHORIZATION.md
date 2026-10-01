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
Edge Functions use a privileged DB connection only for the audited service functions and always derive `userId` from a verified JWT.

## Verified by tests (`packages/database/test/security.test.ts`)

privilege escalation (self role grant, moderator grant), cross-user profile edit, `account_state` change, creator trust self-assignment, ownership forgery, direct publish,
verification/moderation tampering, editing others' content, published-version immutability, answer-key visibility, official authoring/publishing without identity or gates, author forging gates,
report impersonation/dup, moderation function permission, audit append-only, block visibility & messaging bypass, rate limits, learner-state forging, event spoofing, staff-only diagnostics/sources/pipeline, storage path scoping.
