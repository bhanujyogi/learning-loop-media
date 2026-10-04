# Content system

One envelope (`content_items`) + versioned typed bodies (`content_versions.body`, validated by `packages/validation`, `content_schema_v1`).
Types: video, note, question, quiz, flashcard, lesson, course, pdf, audio, image, interactive.

## Bodies

- **note**: structured blocks (heading, paragraph, list, table, formula, image, concept_link, revision_prompt, callout). No raw HTML.
- **question** (10 types): single_choice, multi_choice, true_false, fill_blank, numerical, matching, ordering, image_based, map_based, application.
  Public body in `content_versions.body`; `answer` + `explanation` in `content_answer_keys` (frozen with the version). Schema refinements reject unknown option ids,
  duplicate ids, all-options-correct, non-permutation orderings, repeated matches.
- **flashcard**, **quiz** (references questions by id), **video** (media references + duration + transcript), **interactive** (see INTERACTIVE_CONTENT.md).
- **course → module → items** are _references_ (`module_items.content_id`), so the same knowledge unit serves many courses.

## Versioning

One mutable draft per content (partial unique index); `publish_content()` freezes it (`state='published'`, `frozen_at`) and supersedes the previous published version. Frozen bodies and answer keys are immutable (trigger).
Editing a published item opens a new draft `vN+1` — repeated draft edits update that single row (no duplicate records).

## Graph

Exam → Subject → Chapter → Topic → Concept (+ prerequisites, relations) ; `content_concepts` (role: primary/secondary/prerequisite/assesses), `content_exams`, `content_relations`
(related, prerequisite, followup, alternative_explanation, related_question/quiz/flashcard/interactive). `exam_concepts.relevance` is the syllabus mapping (data, with `source_note`).

## Atomisation

A concept can power note → question → flashcard → interactive → video; they share `content_concepts` rows and relation edges rather than duplicating knowledge.

## Freshness

`current / needs_review / outdated / archived`; outdated/archived are excluded from feeds. Exam-related official content must be reviewed against current authoritative sources; do not hardcode exam patterns.

## Language

`language` (BCP-47-like) on every item; `name_i18n` on curriculum rows. No automatic translation.
