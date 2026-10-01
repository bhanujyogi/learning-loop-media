/**
 * Structured logging + error-reporting abstraction (docs/OBSERVABILITY in ARCHITECTURE.md).
 * Redacts secret-looking keys; swap `setLogSink` to forward to Sentry/Logflare/etc. later.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogRecord {
  level: LogLevel;
  msg: string;
  ts: string;
  [k: string]: unknown;
}
export type LogSink = (r: LogRecord) => void;

const SECRET = /(pass(word)?|secret|token|authorization|api[_-]?key|jwt|cookie|service[_-]?role)/i;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        SECRET.test(k) ? '[redacted]' : redact(x, depth + 1),
      ]),
    );
  return typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v;
}

// eslint-disable-next-line no-console
let sink: LogSink = (r) => console[r.level === 'debug' ? 'log' : r.level](JSON.stringify(r));
export const setLogSink = (s: LogSink) => {
  sink = s;
};

export const log = {
  debug: (msg: string, ctx: Record<string, unknown> = {}) =>
    sink({ level: 'debug', msg, ts: new Date().toISOString(), ...(redact(ctx) as object) }),
  info: (msg: string, ctx: Record<string, unknown> = {}) =>
    sink({ level: 'info', msg, ts: new Date().toISOString(), ...(redact(ctx) as object) }),
  warn: (msg: string, ctx: Record<string, unknown> = {}) =>
    sink({ level: 'warn', msg, ts: new Date().toISOString(), ...(redact(ctx) as object) }),
  error: (msg: string, ctx: Record<string, unknown> = {}) =>
    sink({ level: 'error', msg, ts: new Date().toISOString(), ...(redact(ctx) as object) }),
};

/** Time an async operation and log its duration (important-operation timing). */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  ctx: Record<string, unknown> = {},
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    log.info(name, { ...ctx, ms: Date.now() - t0 });
    return r;
  } catch (e) {
    log.error(name, { ...ctx, ms: Date.now() - t0, error: (e as Error)?.message });
    throw e;
  }
}
