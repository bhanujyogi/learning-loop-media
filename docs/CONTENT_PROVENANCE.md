# Content provenance

Every externally derived or generated official object can answer: _where from, whose, which license, transformed how, which sources, which model/process, which version, published by whom, when._

| Question                                       | Where recorded                                                                                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source(s)                                      | `content_provenance_sources` → `sources` (+ `source_documents`) — many sources per content version                                                   |
| Original author/publisher, URL, retrieval date | `sources` + `source_documents.retrieved_at/url`; `ProvenanceSource` in validation                                                                    |
| License at time of derivation                  | `content_provenance_sources.license_snapshot` (frozen: later source edits don't rewrite history; source edits are audited)                           |
| Transformation                                 | `content_provenance.transformation`, `process_name`                                                                                                  |
| Model / process                                | `generated_by` (human/pipeline/model), `model_identifier`, `model_version`, `prompt_version`, `generated_at` (DB check: model ⇒ id + prompt version) |
| Version                                        | `content_provenance.content_version_id` (UNIQUE), `content_versions` immutable once published                                                        |
| Publisher / when                               | `publish_log` (idempotency key, `published_by`, `publishing_identity_id`), `audit_log` `content.publish`, `content_items.published_at`               |
| Validation/review state                        | `validation_status`, `review_status`, `quality_gate_results`                                                                                         |

Provenance is never deleted when content is unpublished or archived. Admin → _Content → detail_ renders versions, provenance, sources and gate results for inspection.
User-generated content records creator/owner/uploader and timestamps; provenance rows are optional for it.

**Gate–content binding (audit C2):** `quality_gate_results.content_hash` = `app.version_hash(version)` assigned by the database at write time and re-checked at publish. The publish audit entry records the hash that was published.
