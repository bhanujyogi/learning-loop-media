import { createHash } from 'node:crypto';
import type { StorageProvider } from './storage.ts';

/** Server-trusted media policy. Client-declared MIME types are NEVER trusted: bytes are sniffed. */
export const MEDIA_POLICY = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/quicktime', 'video/webm'], maxBytes: 200 * 1024 * 1024 },
  audio: {
    mimes: ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'],
    maxBytes: 50 * 1024 * 1024,
  },
  pdf: { mimes: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
} as const;
export type MediaKind = keyof typeof MEDIA_POLICY;

/** Magic-number sniffing for the allowed formats (small, dependency-free). */
export function sniffMime(head: Uint8Array): string | null {
  const b = head;
  const ascii = (o: number, s: string) => s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 'PNG')) return 'image/png';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  if (ascii(4, 'ftyp')) return ascii(8, 'qt') ? 'video/quicktime' : 'video/mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (ascii(0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export type MediaCheck = { ok: true; mime: string } | { ok: false; reason: string };

export function validateUpload(
  kind: MediaKind,
  declaredMime: string,
  sizeBytes: number,
  head: Uint8Array,
): MediaCheck {
  const policy = MEDIA_POLICY[kind];
  if (sizeBytes <= 0 || sizeBytes > policy.maxBytes)
    return { ok: false, reason: 'size out of range' };
  const sniffed = sniffMime(head);
  if (!sniffed) return { ok: false, reason: 'unrecognised file signature' };
  if (!(policy.mimes as readonly string[]).includes(sniffed))
    return { ok: false, reason: `type ${sniffed} not allowed for ${kind}` };
  const family = (m: string) => m.split('/')[0];
  if (family(declaredMime) !== family(sniffed))
    return { ok: false, reason: 'declared type does not match content' };
  return { ok: true, mime: sniffed };
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Storage key layout: never user-controlled filenames (prevents path tricks / collisions). */
export function storageKey(
  ownerId: string,
  mediaId: string,
  variant: string,
  mime: string,
): string {
  const ext =
    (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/webm': 'webm',
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/ogg': 'ogg',
        'audio/wav': 'wav',
        'application/pdf': 'pdf',
      } as Record<string, string>
    )[mime] ?? 'bin';
  return `${ownerId}/${mediaId}/${variant}.${ext}`;
}

export class MediaService {
  constructor(
    private readonly provider: StorageProvider,
    private readonly bucket: string,
  ) {}
  get providerId() {
    return this.provider.id;
  }
  async prepareUpload(p: {
    ownerId: string;
    mediaId: string;
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
  }) {
    const policy = MEDIA_POLICY[p.kind];
    if (
      !(policy.mimes as readonly string[]).includes(p.mimeType) ||
      p.sizeBytes <= 0 ||
      p.sizeBytes > policy.maxBytes
    )
      throw new Error('upload not permitted by policy');
    const key = storageKey(p.ownerId, p.mediaId, 'original', p.mimeType);
    const signed = await this.provider.createSignedUpload(this.bucket, key, {
      mimeType: p.mimeType,
      maxBytes: policy.maxBytes,
    });
    return { provider: this.provider.id, bucket: this.bucket, key, upload: signed };
  }
  url(key: string, ttl?: number) {
    return this.provider.createSignedDownload(this.bucket, key, ttl);
  }
}
