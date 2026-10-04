import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '@learning-loop/shared';
import { en, type MessageKey } from './en';
import { hi } from './hi';

export type { MessageKey };
export type Catalogue = Record<MessageKey, string>;
/** Base keys of plural pairs (`foo_one` + `foo_other` → `foo`), usable with `count`. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer B}_one`
    ? B
    : never
  : never;
export type Params = Record<string, string | number>;

/** One catalogue per supported locale. Adding a language = a new file + one line here + the code in `SUPPORTED_LOCALES`. */
export const CATALOGUES: Record<Locale, Catalogue> = { en, hi };

/** CLDR-style plural category. Only `one`/`other` are needed for the current languages (Hindi treats 0 and 1 as `one`). */
export function pluralCategory(locale: Locale, n: number): 'one' | 'other' {
  if (locale === 'hi') return n === 0 || n === 1 ? 'one' : 'other';
  return n === 1 ? 'one' : 'other';
}

const interpolate = (s: string, params?: Params) =>
  params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;

/**
 * Looks up a message. Missing keys in a non-default catalogue fall back to English (so a half-translated language still
 * works); a key missing everywhere returns the key itself so the gap is visible instead of blank. Pass `count` to select
 * `key_one` / `key_other` and have `{count}` interpolated. NEVER translates arbitrary strings: content comes in its own language.
 */
export function translate(
  locale: Locale,
  key: MessageKey | PluralKey,
  params?: Params & { count?: number },
  catalogues: Record<Locale, Partial<Catalogue>> = CATALOGUES,
): string {
  const pick = (loc: Locale, k: string) => (catalogues[loc] as Record<string, string>)[k];
  let k: string = key;
  if (typeof params?.count === 'number') {
    const plural = `${key}_${pluralCategory(locale, params.count)}`;
    if (pick(locale, plural) !== undefined || pick(DEFAULT_LOCALE, plural) !== undefined)
      k = plural;
  }
  return interpolate(pick(locale, k) ?? pick(DEFAULT_LOCALE, k) ?? key, params);
}

/** Device language → a supported locale (region/script ignored: `hi-IN` → `hi`). */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const base = tag?.toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(base) ? base : null;
}

/**
 * Which language the UI uses. Once onboarding is done the account's `profiles.locale` is authoritative (so the preference
 * follows the learner across devices). Before that (sign-in screens, onboarding step 1) the locally chosen / device language
 * wins, because the profile still holds the schema default.
 */
export function resolveLocale(input: {
  onboarded: boolean;
  profileLocale?: string | null;
  storedLocale?: string | null;
  deviceLocale?: string | null;
}): Locale {
  if (input.onboarded && isSupportedLocale(input.profileLocale)) return input.profileLocale;
  if (isSupportedLocale(input.storedLocale)) return input.storedLocale;
  return matchLocale(input.deviceLocale) ?? DEFAULT_LOCALE;
}

/** Curriculum rows carry `name_i18n` ({ "hi": "…" }); fall back to the canonical `name`. */
export function localName(
  row: { name: string; name_i18n?: Record<string, unknown> | null },
  locale: Locale,
): string {
  const v = row.name_i18n?.[locale];
  return typeof v === 'string' && v.trim() ? v : row.name;
}
