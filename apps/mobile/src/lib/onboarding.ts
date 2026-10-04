import type { Locale, PreparationLevel } from '@learning-loop/shared';

export const ONBOARDING_STEPS = ['language', 'goal', 'subjects', 'level', 'date'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
/** Language is always captured (it has a default and cannot be blank); every other step may be skipped. */
export const isSkippable = (s: OnboardingStep) => s !== 'language';

export interface OnboardingState {
  language: Locale;
  examId?: string;
  subjects: string[];
  level?: PreparationLevel;
  date: string;
}

/** Inserts dashes while typing digits: `20270315` → `2027-03-15`. Non-digits are dropped. */
export function formatDateInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)].filter(Boolean).join('-');
}

/** Valid = a real calendar date strictly after `now` (UTC day). Empty means "not provided" (valid, optional). */
export function parseExamDate(
  input: string,
  now: number = Date.now(),
): { ok: true; iso: string | undefined } | { ok: false } {
  const s = input.trim();
  if (!s) return { ok: true, iso: undefined };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { ok: false };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return { ok: false }; // e.g. 2027-02-31
  const today = new Date(now);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (t <= startOfToday || y > today.getUTCFullYear() + 10) return { ok: false };
  return { ok: true, iso: s };
}

/** The body for the `onboarding` Edge Function (validated again server-side). */
export function buildOnboardingPayload(s: OnboardingState, now: number = Date.now()) {
  const date = parseExamDate(s.date, now);
  return {
    language: s.language,
    examId: s.examId,
    examDate: date.ok ? date.iso : undefined,
    preparationLevel: s.level,
    interestSubjectIds: s.subjects,
  };
}
