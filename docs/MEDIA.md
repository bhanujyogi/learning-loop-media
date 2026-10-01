# Media

`MediaService → StorageProvider → SupabaseStorageProvider` (today) / `CloudflareR2Provider` (stub; deliberately not implemented).

- App data stores **logical references**: `media_assets(storage_provider, bucket, storage_key, mime_type, size_bytes, duration_ms, width, height, checksum_sha256, status, variant)`; no URLs, no binary in Postgres.
- Bucket `media` is **private**; clients receive short-lived signed URLs. Storage policies: write/update/delete only under `<user_id>/…`; read own files or files attached to content the user may see (`status='ready'`).
- Upload flow (target): create `media_assets(status='pending')` → signed upload (key from `storageKey(owner, mediaId, variant, mime)`, never user filenames) → server validation (`validateUpload`: size cap per kind, **magic-number sniffing**, declared-vs-actual family check, checksum) → `status='ready'|'rejected'`.
  Implemented: policies, key layout, sniffing/validation, provider abstraction. **Not implemented:** the server-side finaliser/Edge Function, thumbnails/transcoding, AV scan.
- Video MVP: single original file; schema anticipates `processed`, `thumbnail`, `poster`, `caption` variants and adaptive streaming/CDN later.
- Mobile video (`VideoCard`): plays only when active, preloads neighbours, parent unmounts distant cards (`feed-window.ts` `mediaState`); mute default; captions TODO.
- Migrating to R2/S3: implement `StorageProvider`, set `storage_provider='r2'` for new rows, copy old objects lazily; callers unchanged.
