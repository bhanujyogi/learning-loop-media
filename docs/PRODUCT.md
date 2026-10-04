# Product

**Learning Loop** is a consumer-grade social learning network: an endless personalised feed of short educational content (video, notes, questions, flashcards, interactive experiences) where every interaction teaches the system what helps _this_ learner learn.

## Loop

`interesting content → engagement → learning interaction → feedback → better learner model → better recommendations → voluntary return`.
It optimises learning, not screen time. No daily feed cap, but no manipulation: no false urgency, deceptive exits, misleading notifications, or reward withholding.

## Audience

Initially SSC, Railway, Banking and Rajasthan competitive exams. Exams/syllabi/subjects/regions/languages are data and extensible; no exam pattern is hardcoded.

## Ecosystems

Official content (explicit publishing identities, provenance, quality gates) and user-generated content (immediate upload, post-moderation). Structural dimensions: ownership, source type, verification, publishing, moderation, freshness.

## First usable version (what the tests exercise)

sign up → short onboarding → personalised starter feed → read/answer → server feedback (explanation, XP, mastery) → save/like → learner state updates → next feed changes. Implemented across mobile + Edge Functions + SQL; the Edge/mobile layers are verified only by typecheck/bundling (see PROJECT_STATUS.md).

## Principles

Learning over engagement · explainable recommendations · privacy by design · local-only AI · no fake features (truthful unavailable states) · provenance and rights first · accessibility and low-end-device performance as requirements.
