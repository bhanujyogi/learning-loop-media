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

## Retention (policy; job not yet implemented)

Raw events: 90 d for engagement events, 365 d for learning events, 730 d for safety events (per-event `retentionDays`), then aggregated; `rate_limit_events` pruned hourly; audit log retained indefinitely.

## Scale path

Supabase tables now → partition `events` by month → ship to a warehouse when volume justifies. Boundaries (`recordEvents`, aggregation jobs) already isolate this.
