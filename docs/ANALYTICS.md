# Analytics

## Event taxonomy (`packages/analytics/src/taxonomy.ts` — single source of truth)

Each event declares: `source` (client/server/job), allowed payload keys, privacy class, aggregation, model usage, raw retention days. Covered: session_started/ended, feed_impression, content_visible, watch_start/progress/complete, skip, replay, like/unlike, save/unsave, share, follow/unfollow, comment (id only, never text),
content_open, note_open, quiz_open, question_answered, answer_correct/incorrect, hint_used, confidence_submitted, flashcard_reviewed, review_completed, concept_mastered, concept_reviewed, interaction_completed, content_reported, creator_profile_opened, next_card_requested.
`sanitizeEvent` (used by `recordEvents` and the server answer path): drops unknown events, undeclared keys, secret-looking keys, non-primitive values; truncates strings to 128; clamps client timestamps (±7 d / +1 min).

## Behavioural weighting

Configurable tables `ENGAGEMENT_SIGNALS` and `LEARNING_SIGNALS` (recommendation-engine/features.ts) — starting points, not truths (see LEARNER_MODEL.md). `skip` → `skip_immediate` if <1.5 s watched. Learning-type events from clients never create mastery.

## Pipeline

`app (offline queue, batch 50, backoff) → events function → raw events → learner features (incremental) → recommendations`. Raw `events` stay separate from aggregated features; expensive aggregation is not done in the feed request.

## Metrics (design)

Content: impressions, views, completion, replay, saves, shares, comments, question engagement, correctness, learning gain (`content_stats`, `content_quality_signals`).
Creators: reach, engagement, saves, learning interaction, follower growth. Courses: open/completion/quiz performance/weak points/abandonment. Platform: D1/D7 return, delayed-recall success, mastery gain.
**Engagement ≠ learning:** both tracked separately; high-engagement/low-learning content is flagged for revision via quality signals.

## Background jobs (`packages/database/src/jobs`; scheduled via the secured `jobs` Edge Function; idempotent and tested)

- `aggregateContentQuality`: per-question incorrect/abandonment/report rates, **recovery rate** (wrong first, right later = learning-gain proxy), `needs_revision` flag (≥90 % wrong with ≥20 answers, ≥70 % immediate-skip with ≥30 views, or ≥3 reports), `suggested_difficulty` stored as _evidence_ (official difficulty is never changed silently), plus `content_stats.learning_gain` and `quality_score` (completion + saves − immediate skips).
- `pruneRawData`: deletes raw events past each event's `retentionDays` (90 d engagement, 365 d learning, 730 d safety) and `rate_limit_events` older than 1 day. **It deletes** — run aggregation first. No per-user rollup table exists yet, so long-term behavioural history lives only in `user_features`, `concept_mastery`, `review_history` and attempts.
- `enqueueReviewDueNotifications`: ≥3 due reviews, ≤1 per user per UTC day (unique `dedupe_key`), respects `notification_preferences('review_due')`. Push delivery is not wired.

Audit log is retained indefinitely.

## Scale path

Supabase tables now → partition `events` by month → ship to a warehouse when volume justifies. Boundaries (`recordEvents`, aggregation jobs) already isolate this.

## Hardening (audit H2/H5/H9)

- **Write path:** clients have no INSERT policy or privilege on `events`; only `recordEvents`/`submitAnswer` (as the least-privileged `app_server` role) write, always through `sanitizeEvent`. Forged skip/save/answer events through the database API are no longer possible.
- **Distinct learners:** `aggregateContentQuality` uses each learner's _first_ attempt, distinct viewers/skippers/savers and weighted distinct reporters; thresholds are 20 learners / 30 viewers / report weight 3.0. One user's repeated attempts or events are one data point.
- **Outcome attribution:** outcome events may carry `recommendation_id` (taxonomy keys updated). `recommendation_outcomes` (staff-only, `security_invoker`) joins by user + recommendation + content/question id, so one user cannot attribute outcomes to another's recommendation. Indexed on `events((payload->>'recommendation_id'))` and `((payload->>'content_id'), name, created_at)`.
