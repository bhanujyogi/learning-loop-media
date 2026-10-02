#!/usr/bin/env node
// Verifies the Edge Functions under a REAL Deno runtime: type-check + module resolution (import map, explicit .ts specifiers),
// then starts each function and probes its auth gates. This is NOT the Supabase Edge Runtime/CLI and does not touch a database;
// it catches the module-resolution class of failure (audit H7). Usage: DENO=/path/to/deno node scripts/check-edge-functions.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const deno = process.env.DENO || 'deno';
const probe = spawnSync(deno, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  if (process.env.REQUIRE_DENO === '1') {
    console.error('REQUIRE_DENO=1 but deno is not available');
    process.exit(1);
  }
  console.log(
    'deno not found — skipping Edge Function verification (set DENO=… or REQUIRE_DENO=1)',
  );
  process.exit(0);
}
const root = join(import.meta.dirname, '..', 'supabase', 'functions');
const cfg = join(root, 'deno.json');
const fns = ['submit-answer', 'feed', 'events', 'onboarding', 'jobs'];
let failed = false;
const fail = (m) => {
  console.error('FAIL', m);
  failed = true;
};

for (const f of fns) {
  const entry = join(root, f, 'index.ts');
  if (!existsSync(entry)) {
    fail(`${f}: missing entry`);
    continue;
  }
  const r = spawnSync(deno, ['check', '--config', cfg, entry], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (r.status !== 0) fail(`${f}: deno check failed\n${r.stderr}`);
  else console.log(`ok  check  ${f}`);
}

const cases = [
  ['submit-answer', 'POST', '', {}, 401],
  ['feed', 'GET', '', {}, 401],
  ['events', 'POST', '', {}, 401],
  ['onboarding', 'POST', '', {}, 401],
  ['jobs', 'POST', '', {}, 401], // no JOBS_SECRET configured → closed
  [
    'jobs',
    'POST',
    '?job=unknown',
    { authorization: 'Bearer ' + 'x'.repeat(32) },
    400,
    { JOBS_SECRET: 'x'.repeat(32), SUPABASE_DB_URL: 'postgres://u:p@127.0.0.1:1/db' },
  ],
  [
    'jobs',
    'POST',
    '?job=retention',
    { authorization: 'Bearer wrong-wrong-wrong-wrong-wrong' },
    401,
    { JOBS_SECRET: 'x'.repeat(32), SUPABASE_DB_URL: 'postgres://u:p@127.0.0.1:1/db' },
  ],
];
let port = 18700 + Math.floor(Math.random() * 500);
for (const [fn, method, qs, headers, want, extraEnv = {}] of cases) {
  const p = port++;
  const child = spawn(
    deno,
    ['run', '--config', cfg, '--allow-net', '--allow-env', join(root, fn, 'index.ts')],
    {
      env: {
        ...process.env,
        NO_COLOR: '1',
        DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${p}`,
        SUPABASE_URL: 'http://127.0.0.1:1',
        SUPABASE_ANON_KEY: 'anon',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.stdout.on('data', (d) => (err += d));
  let status = null;
  for (let i = 0; i < 60 && status === null; i++) {
    await sleep(250);
    try {
      status = (await fetch(`http://127.0.0.1:${p}/${qs}`, { method, headers })).status;
    } catch {
      /* not listening yet */
    }
  }
  child.kill('SIGKILL');
  if (status === want) console.log(`ok  serve  ${fn}${qs} ${method} → ${status}`);
  else fail(`${fn}${qs}: expected ${want}, got ${status}\n${err.slice(0, 600)}`);
}
process.exit(failed ? 1 : 0);
