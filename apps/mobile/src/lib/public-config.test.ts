import { createPublicClient } from '@learning-loop/database/client';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const ALLOWED = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const sources = files(SRC).filter((f) => !f.endsWith('.test.ts'));

describe('the mobile app carries only public Supabase configuration', () => {
  it('reads exactly the two public EXPO_PUBLIC_* variables and nothing else from the environment', () => {
    const used = new Set(
      sources.flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!),
      ),
    );
    expect([...used].sort()).toEqual([...ALLOWED].sort());
  });
  it('mentions no privileged credential names in app source', () => {
    const banned =
      /(SERVICE_ROLE|sb_secret_|SUPABASE_DB_URL|APP_DB_URL|JOBS_SECRET|ACCESS_TOKEN|service_role)/;
    const hits = sources.filter((f) => banned.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
  it('the client factory accepts a publishable key and refuses secret-style keys', () => {
    const url = 'https://example.supabase.co';
    expect(() =>
      createPublicClient({ url, anonKey: 'sb_publishable_abcdefghijklmnop' }),
    ).not.toThrow();
    expect(() => createPublicClient({ url, anonKey: 'sb_secret_abcdefghijklmnop' })).toThrow(
      /privileged/,
    );
  });
  // Only runs on a machine that has a local, git-ignored apps/mobile/.env (CI has none).
  const envFile = join(SRC, '..', '.env');
  it.skipIf(!existsSync(envFile))(
    'a local .env holds only the two public variables, with a public-shaped key',
    () => {
      const lines = readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'));
      const kv = Object.fromEntries(
        lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      );
      expect(Object.keys(kv).sort()).toEqual([...ALLOWED].sort());
      expect(kv.EXPO_PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/);
      expect(kv.EXPO_PUBLIC_SUPABASE_ANON_KEY).toMatch(/^sb_publishable_[A-Za-z0-9_-]+$/);
    },
  );
});
