import { describe, expect, it } from 'vitest';
import {
  assertProject,
  FUNCTIONS,
  includeInBundle,
  isSafeEmail,
  migrationName,
  pendingMigrations,
  PROJECT_REF,
  roleSql,
} from '../../../scripts/lib/hosted-setup.mjs';

describe('hosted setup helpers', () => {
  it('matches migrations by NAME (hosted history has apply-time versions) and applies only pending ones, in order', () => {
    const files = [
      '20260102000006_ugc_launch_safety.sql',
      '20260101000001_foundation.sql',
      '20260102000005_mvp_language_and_level.sql',
      'README.md',
    ];
    expect(migrationName(files[0]!)).toBe('ugc_launch_safety');
    expect(pendingMigrations(files, ['foundation', 'mvp_language_and_level'])).toEqual([
      '20260102000006_ugc_launch_safety.sql',
    ]);
    expect(pendingMigrations(files, [])).toEqual([
      '20260101000001_foundation.sql',
      '20260102000005_mvp_language_and_level.sql',
      '20260102000006_ugc_launch_safety.sql',
    ]);
    expect(
      pendingMigrations(files, ['foundation', 'mvp_language_and_level', 'ugc_launch_safety']),
    ).toEqual([]);
  });
  it('only a plain email is ever inlined into SQL (no quotes, semicolons, whitespace)', () => {
    expect(isSafeEmail('bhanuyogi215@gmail.com')).toBe(true);
    for (const bad of [
      "a'b@x.com",
      'a@x.com; drop table x',
      'a b@x.com',
      '',
      'nope',
      'a@x',
      "a@x.com'--",
      42,
      null,
    ])
      expect(isSafeEmail(bad as string), String(bad)).toBe(false);
    expect(() => roleSql("x'@y.com")).toThrow();
    expect(roleSql('A@B.com')).toContain("lower(email) = 'a@b.com'");
    expect(roleSql('a@b.com')).not.toMatch(/delete|drop|truncate/i);
  });
  it('refuses every project except the Learning Loop one', () => {
    expect(() => assertProject(PROJECT_REF)).not.toThrow();
    expect(() => assertProject('someotherprojectref12')).toThrow(/refusing/);
  });
  it('deploys the five functions the app uses, bundling function folders and package sources but never tests or lockfiles', () => {
    expect(FUNCTIONS).toEqual(['onboarding', 'feed', 'events', 'submit-answer', 'create-content']);
    expect(includeInBundle('supabase/functions/feed/index.ts')).toBe(true);
    expect(includeInBundle('supabase/functions/deno.json')).toBe(true);
    expect(includeInBundle('packages/database/src/services/feed.ts')).toBe(true);
    expect(includeInBundle('packages/database/src/services/feed.test.ts')).toBe(false);
    expect(includeInBundle('supabase/functions/deno.lock')).toBe(false);
    expect(includeInBundle('apps/mobile/.env')).toBe(false);
    expect(includeInBundle('packages/database/test/mvp.test.ts')).toBe(false);
  });
});
