#!/usr/bin/env node
// Release gate: run before building the store binary. `node scripts/check-release.mjs` (exit 1 = do not ship).
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const problems = [];
const need = (ok, msg) => ok || problems.push(msg);

// 1. legal details filled in (privacy policy / terms name the operator and a contact)
const op = json('apps/mobile/src/legal/operator.json');
for (const [k, v] of Object.entries(op))
  need(
    v && !/\{\{.*\}\}/.test(v),
    `apps/mobile/src/legal/operator.json: "${k}" is still a placeholder`,
  );

// 2. app config
const app = json('apps/mobile/app.json').expo;
need(app.android?.package === 'com.learningloop.app', 'android.package changed or missing');
need(Number.isInteger(app.android?.versionCode), 'android.versionCode missing');
need(/^\d+\.\d+\.\d+$/.test(app.version ?? ''), 'version must look like 1.0.0');
const blocked = app.android?.blockedPermissions ?? [];
for (const p of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE'])
  need(blocked.includes(`android.permission.${p}`), `permission ${p} should be blocked`);
need(app.android?.allowBackup === false, 'android.allowBackup should be false');

// 3. build profiles carry only PUBLIC client configuration
const eas = json('apps/mobile/eas.json');
for (const profile of ['preview', 'production']) {
  const env = eas.build?.[profile]?.env ?? {};
  need(
    /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.EXPO_PUBLIC_SUPABASE_URL ?? ''),
    `eas.json ${profile}: EXPO_PUBLIC_SUPABASE_URL missing or malformed`,
  );
  need(
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? ''),
    `eas.json ${profile}: EXPO_PUBLIC_SUPABASE_ANON_KEY must be a publishable key (sb_publishable_…)`,
  );
  for (const k of Object.keys(env))
    need(
      k.startsWith('EXPO_PUBLIC_'),
      `eas.json ${profile}: only EXPO_PUBLIC_* variables allowed, found ${k}`,
    );
}

// 4. no secrets in tracked files
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const text = files.filter(
  (f) => !/\.(png|jpg|jpeg|gif|ico|ttf|hbc|lock|wasm)$/.test(f) && !f.endsWith('pnpm-lock.yaml'),
);
const decode = (t) => {
  try {
    return JSON.parse(
      Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
  } catch {
    return {};
  }
};
for (const f of text) {
  if (f === 'scripts/check-release.mjs') continue;
  let c = '';
  try {
    c = read(f);
  } catch {
    continue;
  }
  if (/sb_secret_[A-Za-z0-9_-]{20,}/.test(c))
    problems.push(`${f}: contains a secret-style Supabase key`);
  for (const m of c.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g))
    if (decode(m[0]).role === 'service_role') problems.push(`${f}: contains a service_role JWT`);
}
need(!files.includes('apps/mobile/.env'), 'apps/mobile/.env must not be committed');

if (problems.length) {
  console.error('RELEASE CHECK FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('release check passed');
