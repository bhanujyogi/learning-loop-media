import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, RATE_LIMITS, RANKING_V1 } from '@learning-loop/config';
import { GATE_NAMES } from '@learning-loop/content-engine';
import * as S from '@learning-loop/shared';
import { freshDb } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
});

const enumValues = async (name: string) =>
  (
    await db.query<{ e: string }>(
      `select enumlabel e from pg_enum where enumtypid = '${name}'::regtype order by enumsortorder`,
    )
  ).rows.map((r) => r.e);

describe('SQL ↔ TypeScript parity', () => {
  const pairs: [string, readonly string[]][] = [
    ['content_type', S.CONTENT_TYPES],
    ['ownership_kind', S.OWNERSHIP_KINDS],
    ['source_type', S.SOURCE_TYPES],
    ['verification_status', S.VERIFICATION_STATUSES],
    ['publishing_status', S.PUBLISHING_STATUSES],
    ['moderation_status', S.MODERATION_STATUSES],
    ['freshness_status', S.FRESHNESS_STATUSES],
    ['hook_type', S.HOOK_TYPES],
    ['format_type', S.FORMAT_TYPES],
    ['license_code', S.LICENSE_CODES],
    ['trust_level', S.TRUST_LEVELS],
    ['job_status', S.JOB_STATUSES],
  ];
  for (const [name, ts] of pairs)
    it(`enum ${name}`, async () => expect(await enumValues(name)).toEqual([...ts]));

  it('rate limit rules match packages/config', async () => {
    const rows = (
      await db.query<{ action: string; max_count: number; window_seconds: number }>(
        `select * from rate_limit_rules`,
      )
    ).rows;
    const sql = Object.fromEntries(
      rows.map((r) => [r.action, { max: r.max_count, windowSeconds: r.window_seconds }]),
    );
    expect(sql).toEqual(RATE_LIMITS);
  });
  it('required official gates match content-engine', async () => {
    const r = await db.query<{ g: string[] }>(`select app.required_gates() g`);
    expect([...r.rows[0]!.g].sort()).toEqual([...GATE_NAMES].sort());
  });
  it('roles in SQL include every shared role', async () => {
    const r = (await db.query<{ name: string }>(`select name from roles`)).rows.map((x) => x.name);
    for (const role of S.ROLES) expect(r).toContain(role);
  });
  it('feature flags in SQL include config flags with the same defaults', async () => {
    const r = (
      await db.query<{ key: string; enabled: boolean }>(`select key, enabled from feature_flags`)
    ).rows;
    for (const [k, v] of Object.entries(FEATURE_FLAGS))
      expect(r.find((x) => x.key === k)?.enabled, k).toBe(v);
  });
  it('ranking_v1 weights sum to 1 (initial formulation)', () => {
    const sum = Object.values(RANKING_V1.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});
