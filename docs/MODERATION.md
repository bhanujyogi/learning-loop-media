# Moderation

Post-moderation model: users publish immediately; new creators' content enters `pending_review` (visible), trusted/verified creators' content is `cleared`. Hidden states: `flagged`, `restricted`, `removed`, `appealed`.

- Reports: one open report per reporter/target (unique index), rate-limited; 3 distinct open reports auto-flag content (`flagged` → hidden pending review).
- Actions only via `apply_moderation_action(kind, id, action, reason)` (`moderation.act`): approve/restore → `cleared`, restrict → `restricted`, remove → `removed`, `suspend_creator` → `creator_restrictions(no_upload)`; resolves reports, updates case, **audits**. Removed/restricted content cannot be republished by its owner.
- Restrictions (`no_upload | no_comment | no_message | suspended`, optional expiry) are enforced inside the relevant guard triggers.
- Appeals table exists (insert own); resolution workflow/UI TODO. Admin UI: queue grouped by target, inspect content/provenance, act with a required reason.
- Not built: AI/automated moderation (intentionally deferred; `moderation_worker` identity exists), moderator notes UI, SLA metrics, notification of decisions to creators.
