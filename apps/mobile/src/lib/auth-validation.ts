import type { MessageKey } from '../i18n/core';

export const MIN_PASSWORD = 8;
// Deliberately permissive: the server is the real validator. This only catches obvious typos before a network round trip.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

export function validateEmail(raw: string): MessageKey | null {
  const e = raw.trim();
  if (!e) return 'auth.err.emailRequired';
  return EMAIL.test(e) ? null : 'auth.err.emailInvalid';
}
export function validatePassword(p: string, mode: 'in' | 'up'): MessageKey | null {
  if (!p) return 'auth.err.passwordRequired';
  // Don't lock out existing accounts with an older shorter password: the length rule applies to NEW passwords only.
  return mode === 'up' && p.length < MIN_PASSWORD ? 'auth.err.passwordShort' : null;
}

interface AuthErrorLike {
  name?: string;
  code?: string;
  status?: number;
  message?: string;
}
/**
 * Maps a Supabase Auth error to a localized message key. Only conditions that don't disclose whether an account exists get
 * a specific message; everything else is a generic failure (no user enumeration).
 */
export function authErrorKey(err: unknown, mode: 'in' | 'up'): MessageKey {
  const e = (err ?? {}) as AuthErrorLike;
  const code = e.code ?? '';
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    /network request failed|failed to fetch|network error|timed? ?out/i.test(e.message ?? '')
  )
    return 'auth.err.offline';
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    e.status === 429
  )
    return 'auth.err.rateLimited';
  if (code === 'weak_password') return 'auth.err.weakPassword';
  if (mode === 'in') {
    if (code === 'email_not_confirmed') return 'auth.err.emailNotConfirmed';
    if (code === 'invalid_credentials') return 'auth.err.invalidCredentials';
    return 'auth.err.signInFailed';
  }
  return 'auth.err.signUpFailed';
}
