# Content ingestion & official publishing pipeline

**Status:** schema, state machine, gates, license evaluation, dedup and publish safeguards are implemented and tested. **No crawler/generator is running** and no content is mass-generated (by design — "implemented but controlled").

## Job stages (`pipeline_jobs.kind`)

`discover_sources → fetch_source → extract_content → normalize_content → generate_learning_objects → validate_content → deduplicate_content → publish_content`.
Status: `queued → running → completed | failed | retrying | cancelled` (DB trigger forbids illegal transitions). `idempotency_key` is UNIQUE, so retries never duplicate;
`content-engine.nextRetryDelayMs` gives capped exponential backoff; `sanitizeError` strips tokens/keys before `error` is stored.

## Source registry (`sources`)

name, url, type, publisher, author, language, subjects, `license`, `license_url`, attribution/commercial/redistribution/modification flags (**null = unknown**), `trust` (high/standard/needs_review/blocked), status, last_checked_at.
New sources default to `needs_review`/`pending`. **Any change to license/terms/trust/status is written to `audit_log` automatically** (no silent permission changes).
`source_documents` = per-retrieval snapshot (`content_hash` UNIQUE per source ⇒ idempotent re-ingest, `license_snapshot` at retrieval time).

## Rights evaluation (`content-engine/license.ts`) — access ≠ reuse

| Input                                                                                                                | Decision                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| proprietary                                                                                                          | reject                                         |
| unknown / unrecognised                                                                                               | flag_for_review                                |
| CC BY-NC*/ND (we transform + monetise)                                                                               | reject                                         |
| open license (PD, CC0, CC BY, CC BY-SA, open gov, MIT, Apache-2) with explicit flags                                 | allow (+attribution, +share-alike propagation) |
| open label but flag explicitly `false`                                                                               | reject (record contradicts label)              |
| open label but rights flags or license URL not recorded                                                              | flag_for_review                                |
| Across multiple sources the worst decision wins. Never bypass paywalls/auth/technical restrictions; never mass-copy. |

## Quality gates (required before official publish; also enforced in SQL)

`schema_valid, source_valid, license_valid, metadata_valid, answer_keys_valid, duplicate_check_passed, content_quality_check_passed`
(`runGates`; results stored in `quality_gate_results`; `app.required_gates()` is parity-tested). Official content needs ≥1 concept, ≥1 exam, difficulty, learning objective, provenance; AI content needs model id + prompt version.
Gate results are written by an independent validator with `pipeline.run`; authors cannot self-certify.

## Dedup (`dedup.ts`)

Normalised exact fingerprint (SHA-256) + 3-word-shingle Jaccard (default threshold 0.8); questions dedup on prompt + sorted option text. No ML. Semantic similarity can be added later (ONNX embeddings) without changing the gate.

## Publish safeguards

`publishIdempotencyKey`, `guardBatch` (max batch 25, rate budget from `RATE_LIMITS.official_publish`), `publish_log` unique key, versions frozen (rollback = publish a prior content as a new version), audit entry per publish.

## Not yet built (see ROADMAP)

Fetchers/extractors per source type, concept identification, generation workers, source refresh/diff, content-need detection from learner weakness, scheduled runners.
