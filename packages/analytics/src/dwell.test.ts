import { describe, expect, it } from 'vitest';
import { dwellSignal } from './taxonomy.ts';

describe('watch/dwell time → engagement signal', () => {
  it('ignores missing/instant views (those are skips), grades the rest by how long the learner stayed', () => {
    expect(dwellSignal(undefined)).toBeNull();
    expect(dwellSignal(Number.NaN)).toBeNull();
    expect(dwellSignal(800)).toBeNull();
    expect(dwellSignal(2500)).toBe('dwell_glance');
    expect(dwellSignal(6000)).toBe('dwell_short');
    expect(dwellSignal(15_000)).toBe('dwell_medium');
    expect(dwellSignal(40_000)).toBe('dwell_long');
  });
  it('a phone left open on a card cannot score higher than a long, real view', () => {
    expect(dwellSignal(3_600_000)).toBe('dwell_long');
  });
});
