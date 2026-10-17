import type { Relationship } from './social';

/** Pure helpers for the profile / explore screens (no React, no network). */

export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
export const NAME_MAX = 40;
export const BIO_SOFT_MAX = 150;
export const SEARCH_MAX = 60;

export const normalizeUsername = (s: string) => s.trim().replace(/^@+/, '').toLowerCase();

/** Why a username can't be used (null = fine). The database stays authoritative (unique + reserved words). */
export function usernameProblem(raw: string): 'length' | 'chars' | null {
  const s = normalizeUsername(raw);
  if (s.length < 3 || s.length > 30) return 'length';
  return USERNAME_RE.test(s) ? null : 'chars';
}

/** Escapes LIKE wildcards (and the escape char) in user-typed text so `%` / `_` match literally. */
export const escapeIlike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Cleans a search box value: trims, drops a leading @, caps length. Returns '' when there is nothing to search. */
export const cleanSearch = (s: string) => s.trim().replace(/^@+/, '').slice(0, SEARCH_MAX).trim();

/** `%text%` ilike pattern for already-cleaned search text. */
export const ilikePattern = (s: string) => `%${escapeIlike(s)}%`;

/** 999 -> "999", 1234 -> "1.2K", 12500 -> "12.5K", 1_000_000 -> "1M". */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  const fmt = (v: number, suffix: string) => {
    const r = Math.round(v * 10) / 10;
    return `${Number.isInteger(r) ? r : r.toFixed(1)}${suffix}`;
  };
  if (n < 1_000_000) {
    const k = n / 1000;
    return Math.round(k * 10) / 10 >= 1000 ? '1M' : fmt(k, 'K');
  }
  const m = n / 1_000_000;
  return Math.round(m * 10) / 10 >= 1000 ? '1B' : fmt(m, 'M');
}

export interface FollowRow {
  follower_id: string;
  followee_id: string;
}
/** Counts from the follow rows that involve me (RLS only returns those). Friends = mutual follows. */
export function followStats(me: string, rows: FollowRow[]) {
  const following = new Set<string>();
  const followers = new Set<string>();
  for (const r of rows) {
    if (r.follower_id === me) following.add(r.followee_id);
    else if (r.followee_id === me) followers.add(r.follower_id);
  }
  let friends = 0;
  for (const id of following) if (followers.has(id)) friends++;
  return { followers: followers.size, following: following.size, friends };
}

export type ProfileAction =
  'addFriend' | 'follow' | 'requested' | 'accept' | 'decline' | 'following' | 'friends' | 'message';
/** Which buttons the other person's profile shows for each relationship. */
export function relationActions(status: Relationship): ProfileAction[] {
  switch (status) {
    case 'self':
      return [];
    case 'friends':
      return ['friends', 'message'];
    case 'request_sent':
      return ['requested'];
    case 'request_received':
      return ['accept', 'decline'];
    case 'following':
      return ['following', 'addFriend'];
    default: // none, followed_by
      return ['addFriend', 'follow'];
  }
}

/** Ids of media attached to a version body (`{ mediaIds: [...] }`); [] when absent/malformed. */
export function bodyMediaIds(body: unknown): string[] {
  const ids = (body as { mediaIds?: unknown } | null)?.mediaIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
}

/** Maps a profile update error to a user-facing reason. */
export function profileSaveError(
  error: { code?: string } | null,
): 'taken' | 'unavailable' | 'failed' | null {
  if (!error) return null;
  if (error.code === '23505') return 'taken';
  if (error.code === '42501') return 'unavailable';
  return 'failed';
}
