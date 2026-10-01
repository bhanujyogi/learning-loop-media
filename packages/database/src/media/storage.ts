/**
 * StorageProvider abstraction (docs/MEDIA.md). The application stores LOGICAL references
 * (media_assets rows: provider, bucket, key) and never a physical URL. Swapping Supabase Storage for
 * Cloudflare R2 / any S3-compatible store means adding a provider, not rewriting callers.
 */
export interface StoredObject {
  key: string;
  sizeBytes: number;
  mimeType: string;
  checksumSha256?: string;
}
export interface SignedUpload {
  url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  expiresAt: number;
}

export interface StorageProvider {
  readonly id: string; // persisted in media_assets.storage_provider
  createSignedUpload(
    bucket: string,
    key: string,
    opts: { mimeType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<SignedUpload>;
  createSignedDownload(bucket: string, key: string, expiresInSeconds?: number): Promise<string>;
  head(bucket: string, key: string): Promise<StoredObject | null>;
  delete(bucket: string, key: string): Promise<void>;
}

/** Minimal subset of supabase-js storage we use (keeps this file dependency-free and mockable). */
export interface SupabaseStorageLike {
  from(bucket: string): {
    createSignedUploadUrl(path: string): Promise<{
      data: { signedUrl: string; token: string } | null;
      error: { message: string } | null;
    }>;
    createSignedUrl(
      path: string,
      expiresIn: number,
    ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    info?(path: string): Promise<{
      data: { size?: number; contentType?: string } | null;
      error: { message: string } | null;
    }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly id = 'supabase';
  constructor(private readonly storage: SupabaseStorageLike) {}
  async createSignedUpload(
    bucket: string,
    key: string,
    opts: { mimeType: string; maxBytes: number; expiresInSeconds?: number },
  ): Promise<SignedUpload> {
    const { data, error } = await this.storage.from(bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`signed upload failed: ${error?.message ?? 'unknown'}`);
    return {
      url: data.signedUrl,
      method: 'PUT',
      headers: { 'content-type': opts.mimeType, 'x-upsert': 'false' },
      expiresAt: Date.now() + (opts.expiresInSeconds ?? 7200) * 1000,
    };
  }
  async createSignedDownload(
    bucket: string,
    key: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    const { data, error } = await this.storage.from(bucket).createSignedUrl(key, expiresInSeconds);
    if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`);
    return data.signedUrl;
  }
  async head(bucket: string, key: string): Promise<StoredObject | null> {
    const info = this.storage.from(bucket).info;
    if (!info) return null;
    const { data } = await this.storage.from(bucket).info!(key);
    return data
      ? { key, sizeBytes: data.size ?? 0, mimeType: data.contentType ?? 'application/octet-stream' }
      : null;
  }
  async delete(bucket: string, key: string): Promise<void> {
    const { error } = await this.storage.from(bucket).remove([key]);
    if (error) throw new Error(`delete failed: ${error.message}`);
  }
}

/** Placeholder to make the migration path explicit. Not implemented: R2 is intentionally out of scope for now. */
export class CloudflareR2Provider implements StorageProvider {
  readonly id = 'r2';
  private nope(): never {
    throw new Error(
      'CloudflareR2Provider is not implemented yet (see docs/MEDIA.md migration plan)',
    );
  }
  createSignedUpload(): Promise<SignedUpload> {
    return this.nope();
  }
  createSignedDownload(): Promise<string> {
    return this.nope();
  }
  head(): Promise<StoredObject | null> {
    return this.nope();
  }
  delete(): Promise<void> {
    return this.nope();
  }
}
