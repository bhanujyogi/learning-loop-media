import { describe, expect, it } from 'vitest';
import { clamp01, redact, setLogSink, log, type LogRecord } from './index.ts';

describe('shared', () => {
  it('clamp01 handles bounds and non-finite input', () => {
    expect([clamp01(-1), clamp01(2), clamp01(0.3), clamp01(NaN)]).toEqual([0, 1, 0.3, 0]);
  });
  it('redacts secret-looking keys at any depth and truncates huge strings', () => {
    const r = redact({
      a: 1,
      auth_token: 'x',
      nested: { apiKey: 'y', ok: 'fine' },
      big: 'z'.repeat(900),
    }) as Record<string, unknown>;
    expect(r.auth_token).toBe('[redacted]');
    expect((r.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
    expect((r.nested as Record<string, unknown>).ok).toBe('fine');
    expect((r.big as string).length).toBeLessThan(600);
  });
  it('logger routes through the sink with redaction', () => {
    const got: LogRecord[] = [];
    setLogSink((r) => got.push(r));
    log.info('hello', { password: 'p', n: 1 });
    expect(got[0]).toMatchObject({ level: 'info', msg: 'hello', password: '[redacted]', n: 1 });
  });
});
