# Database

PostgreSQL via Supabase. Source of truth: `supabase/migrations/*.sql` (ordered, reproducible). Tested against real Postgres semantics with PGlite
(`packages/database/test`). **Every public table has RLS enabled** (a test fails otherwise); the `anon` role has no privileges.

| #   | Migration                   | Contents                                                                                                                                                                                                        |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | foundation                  | enums (mirror `packages/shared`), `audit_log` (append-only), `rate_limit_rules/events` + `app.check_rate_limit`                                                                                                 |
| 02  | identity                    | `profiles`, roles/permissions/user_roles (+guard & audit), organizations, `publishing_identities`(+members), `creator_profiles`, `user_blocks`                                                                  |
| 03  | curriculum                  | exams, subjects, exam_subjects, chapters, topics, concepts, prerequisites (cycle-proof), relations, `exam_concepts` (syllabus mapping with relevance)                                                           |
| 04  | content                     | `content_items` (independent state dimensions), `content_versions` (one mutable draft, frozen when published), `content_answer_keys`, graph links, course modules/items (references, no copies), `media_assets` |
| 05  | content_security            | guards, `publish_content()`, `publish_log` (idempotent), RLS                                                                                                                                                    |
| 06  | sources_provenance_pipeline | `sources` (audited term changes), `source_documents`, `content_provenance(+sources)`, `pipeline_jobs`, `quality_gate_results`                                                                                   |
| 07  | moderation                  | reports (dedupe), cases, actions, restrictions, appeals; auto-flag; `apply_moderation_action()`                                                                                                                 |
| 08  | learning                    | learner_profiles, concept_mastery, question/quiz attempts, review_items/history (FSRS), interaction_results, raw `events`                                                                                       |
| 09  | social                      | follows, likes, saves, shares, comments, notifications(+prefs), `content_stats` (trigger-maintained counters)                                                                                                   |
| 10  | messaging                   | conversations, members, messages, reports; `start_direct_conversation()`; block/rate/privacy guards                                                                                                             |
| 11  | recommendation_gamification | ranking_versions, candidate_sources, user_features, recommendations(+items with `why_shown`), experiments(+assignments), feature_flags, quality signals, XP ledger, progress, achievements                      |
| 12  | hardening                   | revoke all from `anon`, incl. default privileges                                                                                                                                                                |
| 13  | storage                     | private `media` bucket, MIME/size limits, owner-scoped policies                                                                                                                                                 |

## Content state dimensions (never overload one field)

`ownership` (official/creator/user) · `source_type` (original/imported/ai_generated/ai_assisted/community) · `verification` (unverified/source_backed/reviewed/official)
· `publishing` (draft/published/unpublished/archived/deleted) · `moderation` (none/pending_review/flagged/restricted/removed/appealed/cleared) · `freshness` (current/needs_review/outdated/archived).
Checks: official ⇒ org + publishing identity, no user owner; non-official ⇒ user owner.

## Performance notes

- Feed index: `(published_at desc, id desc) where publishing='published' and deleted_at is null`; GIN on `search`; graph-link reverse indexes; per-user time indexes on events/attempts/reviews.
- Cursor pagination is by server-tracked seen set (no offset scans); candidate queries are bounded (`limit`) per source.
- JSON is used only where shape varies by type (`body`, `features`, `why_shown`, `payload`) with size checks.
- `events` is append-only raw data; retention/aggregation plan in ANALYTICS.md. Run `explain analyze` on candidate queries when adding sources (TODO: load-test with ≥1M content rows).

## Conventions

New table ⇒ RLS enabled + explicit policies (default deny) + test. `SECURITY DEFINER` functions set `search_path`. Triggers that guard privileged columns skip only when `auth.uid() is null` (service role / migrations).
