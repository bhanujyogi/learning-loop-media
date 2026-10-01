import { describe, expect, it } from 'vitest';
import { EVENT_NAMES, EVENT_TAXONOMY, sanitizeEvent, skipSignal, FEEDBACK_MAP } from './index';

const NOW = Date.UTC(2026, 5, 1);
describe('event taxonomy', () => {
  it('covers the directive event list', () => {
    for (const n of [
      'feed_impression',
      'watch_complete',
      'skip',
      'replay',
      'save',
      'question_answered',
      'hint_used',
      'confidence_submitted',
      'flashcard_reviewed',
      'concept_mastered',
      'content_reported',
      'next_card_requested',
      'session_started',
      'session_ended',
    ])
      expect(EVENT_NAMES).toContain(n);
  });
  it('no event allows free-text, credential or contact keys', () => {
    for (const [name, spec] of Object.entries(EVENT_TAXONOMY))
      for (const k of spec.payload)
        expect(k, name).not.toMatch(/(pass|secret|token|email|phone|message|body|text)/i);
  });
  it('every feedback mapping refers to a real event', () => {
    for (const k of Object.keys(FEEDBACK_MAP)) expect(EVENT_NAMES).toContain(k);
  });
});
describe('sanitizeEvent', () => {
  it('rejects unknown events', () => expect(sanitizeEvent({ name: 'drop_table' }, NOW)).toBeNull());
  it('drops undeclared and secret-looking keys, truncates strings, keeps primitives only', () => {
    const e = sanitizeEvent(
      {
        name: 'like',
        payload: {
          content_id: 'x'.repeat(500),
          auth_token: 'abc',
          email: 'a@b.c',
          nested: { a: 1 },
        },
      },
      NOW,
    )!;
    expect(Object.keys(e.payload)).toEqual(['content_id']);
    expect((e.payload.content_id as string).length).toBe(128);
  });
  it('clamps implausible client timestamps to server time', () => {
    expect(sanitizeEvent({ name: 'like', at: NOW + 10 * 86_400_000 }, NOW)!.at).toBe(NOW);
    expect(sanitizeEvent({ name: 'like', at: NOW - 1000 }, NOW)!.at).toBe(NOW - 1000);
  });
  it('classifies immediate skips', () => {
    expect(skipSignal({ watched_ms: 400 })).toBe('skip_immediate');
    expect(skipSignal({ watched_ms: 9000 })).toBe('skip');
  });
});
