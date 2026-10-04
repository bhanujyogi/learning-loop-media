import { SUPPORTED_LOCALES } from '@learning-loop/shared';
import { describe, expect, it } from 'vitest';
import { CATALOGUES, localName, matchLocale, resolveLocale, translate } from './core';
import { en } from './en';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalogues', () => {
  it('every supported locale has a catalogue with exactly the English keys', () => {
    for (const l of SUPPORTED_LOCALES)
      expect(Object.keys(CATALOGUES[l]).sort(), l).toEqual(Object.keys(en).sort());
  });
  it('every translation keeps the same {placeholders} as English and is non-empty', () => {
    for (const l of SUPPORTED_LOCALES)
      for (const [k, v] of Object.entries(en)) {
        const t = (CATALOGUES[l] as Record<string, string>)[k]!;
        expect(t.trim().length, `${l}:${k}`).toBeGreaterThan(0);
        expect(placeholders(t), `${l}:${k}`).toEqual(placeholders(v));
      }
  });
  it('plural pairs are complete in every locale', () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of Object.keys(CATALOGUES[l]))
        if (k.endsWith('_one'))
          expect(CATALOGUES[l], `${l}:${k}`).toHaveProperty(k.replace(/_one$/, '_other'));
  });
  it('Hindi strings are actually Hindi, not a copy of English', () => {
    const same = Object.keys(en).filter(
      (k) => (CATALOGUES.hi as Record<string, string>)[k] === (en as Record<string, string>)[k],
    );
    // only language-neutral strings may match (placeholders/format hints/brand)
    expect(same.sort()).toEqual(['onb.date.placeholder', 'q.xp'].sort());
  });
});

describe('translate', () => {
  it('interpolates and selects plurals per locale', () => {
    expect(translate('en', 'learn.reviewsDue', { count: 1 })).toMatch(/^1 item is ready/);
    expect(translate('en', 'learn.reviewsDue', { count: 3 })).toMatch(/^3 items are ready/);
    expect(translate('hi', 'learn.reviewsDue', { count: 0 })).toMatch(/^0 आइटम तैयार है/);
    expect(translate('hi', 'learn.reviewsDue', { count: 2 })).toMatch(/^2 आइटम तैयार हैं/);
    expect(translate('en', 'q.xp', { xp: 12 })).toBe('+12 XP');
  });
  it('falls back to English for a key missing in the locale, and to the key itself if missing everywhere', () => {
    const partial = { en: { ...CATALOGUES.en }, hi: {} } as never;
    expect(translate('hi', 'common.retry', undefined, partial)).toBe('Try again');
    expect(translate('hi', 'nope.key' as never, undefined, partial)).toBe('nope.key');
  });
  it('leaves unknown placeholders visible rather than throwing', () => {
    expect(translate('en', 'auth.checkEmail.body', {})).toContain('{email}');
  });
});

describe('locale resolution', () => {
  it('the account preference wins once onboarded; local/device before that', () => {
    expect(resolveLocale({ onboarded: true, profileLocale: 'hi', storedLocale: 'en' })).toBe('hi');
    // schema default 'en' on a not-yet-onboarded account must not override a language chosen on the sign-in screen
    expect(resolveLocale({ onboarded: false, profileLocale: 'en', storedLocale: 'hi' })).toBe('hi');
    expect(resolveLocale({ onboarded: false, deviceLocale: 'hi-IN' })).toBe('hi');
    expect(resolveLocale({ onboarded: false, deviceLocale: 'fr-FR' })).toBe('en');
    expect(resolveLocale({ onboarded: true, profileLocale: 'xx', storedLocale: 'hi' })).toBe('hi');
    expect(resolveLocale({ onboarded: false })).toBe('en');
  });
  it('matches device tags by language only', () => {
    expect(matchLocale('hi_IN')).toBe('hi');
    expect(matchLocale('EN-us')).toBe('en');
    expect(matchLocale('ta-IN')).toBeNull();
    expect(matchLocale(null)).toBeNull();
  });
  it('picks name_i18n for the locale and falls back to the canonical name', () => {
    expect(localName({ name: 'Reasoning', name_i18n: { hi: 'तर्कशक्ति' } }, 'hi')).toBe(
      'तर्कशक्ति',
    );
    expect(localName({ name: 'Reasoning', name_i18n: {} }, 'hi')).toBe('Reasoning');
    expect(localName({ name: 'Reasoning', name_i18n: { hi: '  ' } }, 'hi')).toBe('Reasoning');
    expect(localName({ name: 'Reasoning' }, 'en')).toBe('Reasoning');
  });
});
