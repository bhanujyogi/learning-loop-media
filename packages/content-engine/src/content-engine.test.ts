import { describe, expect, it } from 'vitest';
import {
  evaluateLicense,
  evaluateSources,
  findDuplicates,
  fingerprint,
  runGates,
  guardBatch,
  publishIdempotencyKey,
  canTransition,
  nextRetryDelayMs,
  sanitizeError,
} from './index';

const terms = (o: Record<string, unknown> = {}) =>
  ({
    license: 'cc_by',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attributionRequired: true,
    commercialUseAllowed: true,
    redistributionAllowed: true,
    modificationAllowed: true,
    ...o,
  }) as never;

describe('license evaluation (access ≠ reuse)', () => {
  it('allows explicit open licenses with attribution flagged', () => {
    const d = evaluateLicense(terms());
    expect(d).toMatchObject({ decision: 'allow', attribution: true });
  });
  it('rejects proprietary and non-commercial; flags unknown', () => {
    expect(evaluateLicense(terms({ license: 'proprietary' })).decision).toBe('reject');
    expect(evaluateLicense(terms({ license: 'cc_by_nc' })).decision).toBe('reject');
    expect(evaluateLicense(terms({ license: 'unknown' })).decision).toBe('flag_for_review');
  });
  it('rejects no-derivatives when we transform', () => {
    expect(evaluateLicense(terms({ license: 'cc_by_nd' })).decision).toBe('reject');
    expect(
      evaluateLicense(terms({ license: 'cc_by_nd' }), { modify: false, commercial: true }).decision,
    ).not.toBe('allow'); // nd isn't in OPEN list → review
  });
  it('flags unrecorded rights instead of assuming permission', () => {
    expect(evaluateLicense(terms({ redistributionAllowed: null })).decision).toBe(
      'flag_for_review',
    );
    expect(evaluateLicense(terms({ licenseUrl: undefined })).decision).toBe('flag_for_review');
  });
  it('explicit false flags override an open-looking label', () => {
    expect(evaluateLicense(terms({ modificationAllowed: false })).decision).toBe('reject');
  });
  it('worst source decides; share-alike propagates', () => {
    const mk = (id: string, o = {}) =>
      ({
        sourceId: id,
        sourceUrl: 'https://x.org',
        sourceName: id,
        retrievedAt: new Date().toISOString(),
        terms: terms(o),
      }) as never;
    expect(evaluateSources([mk('a'), mk('b', { license: 'unknown' })]).decision).toBe(
      'flag_for_review',
    );
    expect(evaluateSources([mk('a'), mk('b', { license: 'proprietary' })]).decision).toBe('reject');
    expect(evaluateSources([mk('a'), mk('b', { license: 'cc_by_sa' })])).toMatchObject({
      decision: 'allow',
      shareAlike: true,
    });
  });
});

describe('dedup', () => {
  it('detects exact (normalised) and near duplicates, ignores unrelated', () => {
    const existing = [
      { id: '1', text: 'Ohm’s Law states that V = I × R in a conductor.' },
      { id: '2', text: 'The capital of Rajasthan is Jaipur, the Pink City.' },
    ];
    expect(findDuplicates('ohm s law states that v i r in a conductor', existing)[0]).toMatchObject(
      { id: '1', exact: true },
    );
    const near = findDuplicates(
      'The capital of Rajasthan is Jaipur, the Pink City of India.',
      existing,
      0.6,
    );
    expect(near[0]?.id).toBe('2');
    expect(findDuplicates('Photosynthesis converts light to chemical energy.', existing)).toEqual(
      [],
    );
  });
  it('fingerprint is case/punctuation insensitive', () =>
    expect(fingerprint('Hello, World!')).toBe(fingerprint('hello world')));
});

const goodQ = {
  prompt: 'What is the SI unit of electrical resistance?',
  explanation: 'Resistance is measured in ohms, named after Georg Ohm.',
  type: 'single_choice',
  options: [
    { id: 'a', text: 'Ohm' },
    { id: 'b', text: 'Volt' },
  ],
  answer: { optionId: 'a' },
};
const officialEnv = {
  type: 'question',
  title: 'Resistance unit',
  language: 'en',
  ownership: 'official',
  sourceType: 'original',
  conceptIds: ['c1'],
  examIds: ['e1'],
  difficulty: 0.3,
  learningObjective: 'Recall units',
};
const prov = {
  sources: [
    {
      sourceId: 's1',
      sourceUrl: 'https://example.org/physics',
      sourceName: 'Open Physics',
      retrievedAt: '2026-01-01T00:00:00Z',
      terms: terms(),
    },
  ],
  generation: { generatedBy: 'human', generatedAt: '2026-01-02T00:00:00Z' },
  contentVersion: 1,
};

describe('quality gates', () => {
  it('passes a well-formed official question', () => {
    const r = runGates({
      envelope: officialEnv,
      body: goodQ,
      provenance: prov,
      existing: [],
      text: goodQ.prompt + ' ' + goodQ.explanation,
    });
    expect(r.failed).toEqual([]);
    expect(r.passed).toBe(true);
  });
  it('blocks official content without provenance', () => {
    expect(
      runGates({ envelope: officialEnv, body: goodQ, text: goodQ.prompt + goodQ.explanation })
        .failed,
    ).toContain('source_valid');
  });
  it('blocks unclear license', () => {
    const p = { ...prov, sources: [{ ...prov.sources[0]!, terms: terms({ license: 'unknown' }) }] };
    expect(
      runGates({
        envelope: officialEnv,
        body: goodQ,
        provenance: p,
        text: goodQ.prompt + goodQ.explanation,
      }).failed,
    ).toContain('license_valid');
  });
  it('blocks bad answer keys and missing metadata', () => {
    const bad = { ...goodQ, answer: { optionId: 'zzz' } };
    const r = runGates({
      envelope: { ...officialEnv, conceptIds: [] },
      body: bad,
      provenance: prov,
      text: 'x'.repeat(40),
    });
    expect(r.failed).toEqual(expect.arrayContaining(['schema_valid', 'metadata_valid']));
  });
  it('blocks duplicates and AI content lacking model metadata', () => {
    const text = goodQ.prompt + ' ' + goodQ.explanation;
    expect(
      runGates({
        envelope: officialEnv,
        body: goodQ,
        provenance: prov,
        existing: [{ id: 'x', text }],
        text,
      }).failed,
    ).toContain('duplicate_check_passed');
    const ai = runGates({
      envelope: { ...officialEnv, sourceType: 'ai_generated' },
      body: goodQ,
      provenance: prov,
      text,
    });
    expect(ai.failed).toContain('source_valid');
  });
  it('rejects placeholder content', () => {
    expect(
      runGates({
        envelope: officialEnv,
        body: goodQ,
        provenance: prov,
        text: 'Lorem ipsum dolor sit amet consectetur',
      }).failed,
    ).toContain('content_quality_check_passed');
  });
});

describe('publish safeguards', () => {
  it('idempotency key is deterministic and version-sensitive', () => {
    const a = publishIdempotencyKey({ publisherId: 'p', contentKey: 'k', contentVersion: 1 });
    expect(a).toBe(publishIdempotencyKey({ publisherId: 'p', contentKey: 'k', contentVersion: 1 }));
    expect(a).not.toBe(
      publishIdempotencyKey({ publisherId: 'p', contentKey: 'k', contentVersion: 2 }),
    );
  });
  it('guards batch size and rate budget', () => {
    expect(guardBatch({ size: 10, recentCount: 0 }).allowed).toBe(true);
    expect(guardBatch({ size: 1000, recentCount: 0 }).allowed).toBe(false);
    expect(guardBatch({ size: 10, recentCount: 45 }).allowed).toBe(false);
    expect(guardBatch({ size: 0, recentCount: 0 }).allowed).toBe(false);
  });
  it('job state machine forbids illegal transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('failed', 'retrying')).toBe(true);
    expect(canTransition('queued', 'completed')).toBe(false);
  });
  it('backoff is exponential and capped', () => {
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(3)).toBe(8000);
    expect(nextRetryDelayMs(50)).toBe(600000);
  });
  it('sanitizes secrets from error messages', () => {
    const s = sanitizeError(
      'failed: apikey=sk_live_abc123 token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
    );
    expect(s).not.toContain('sk_live_abc123');
    expect(s).not.toContain('eyJhbGci');
  });
});
