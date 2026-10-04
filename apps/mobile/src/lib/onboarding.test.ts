import { describe, expect, it } from 'vitest';
import {
  buildOnboardingPayload,
  formatDateInput,
  isSkippable,
  ONBOARDING_STEPS,
  parseExamDate,
} from './onboarding';

const NOW = Date.UTC(2026, 9, 4, 12);

describe('exam date', () => {
  it('formats while typing', () => {
    expect(formatDateInput('2027')).toBe('2027');
    expect(formatDateInput('202703')).toBe('2027-03');
    expect(formatDateInput('20270315')).toBe('2027-03-15');
    expect(formatDateInput('2027-03-15xx99')).toBe('2027-03-15');
  });
  it('accepts a real future date and treats empty as "not provided"', () => {
    expect(parseExamDate('2027-03-15', NOW)).toEqual({ ok: true, iso: '2027-03-15' });
    expect(parseExamDate('', NOW)).toEqual({ ok: true, iso: undefined });
  });
  it('rejects malformed, impossible, past and absurdly far dates', () => {
    for (const bad of [
      '2027-3-5',
      'tomorrow',
      '2027-02-31',
      '2027-13-01',
      '2026-10-04',
      '2025-01-01',
      '2099-01-01',
    ])
      expect(parseExamDate(bad, NOW), bad).toEqual({ ok: false });
    expect(parseExamDate('2026-10-05', NOW)).toEqual({ ok: true, iso: '2026-10-05' });
  });
});

describe('onboarding payload', () => {
  it('always carries the language; other fields are optional (skippable)', () => {
    expect(buildOnboardingPayload({ language: 'hi', subjects: [], date: '' }, NOW)).toEqual({
      language: 'hi',
      examId: undefined,
      examDate: undefined,
      preparationLevel: undefined,
      interestSubjectIds: [],
    });
  });
  it('maps a full set of answers and drops an invalid date instead of sending it', () => {
    const base = {
      language: 'en' as const,
      examId: 'e1',
      subjects: ['s1', 's2'],
      level: 'beginner' as const,
    };
    expect(buildOnboardingPayload({ ...base, date: '2027-03-15' }, NOW)).toMatchObject({
      examId: 'e1',
      examDate: '2027-03-15',
      preparationLevel: 'beginner',
      interestSubjectIds: ['s1', 's2'],
    });
    expect(buildOnboardingPayload({ ...base, date: '2020-01-01' }, NOW).examDate).toBeUndefined();
  });
  it('only the language step is mandatory', () => {
    expect(ONBOARDING_STEPS[0]).toBe('language');
    expect(ONBOARDING_STEPS.filter((s) => !isSkippable(s))).toEqual(['language']);
  });
});
