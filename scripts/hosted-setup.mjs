#!/usr/bin/env node
// One-command hosted setup for the Learning Loop Supabase project (and ONLY that project).
//   SUPABASE_ACCESS_TOKEN=sbp_… node scripts/hosted-setup.mjs --email you@example.com [--dry-run]
// Create the token at https://supabase.com/dashboard/account/tokens (revoke it afterwards). It is read from the
// environment, sent only to api.supabase.com, and never printed or stored.
// Steps: (1) apply pending migrations  (2) deploy the Edge Functions  (3) turn off email confirmation
//        (4) make --email an admin, moderator and trusted creator  (5) verify and print a summary.
import { Blob } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertProject,
  FUNCTIONS,
  includeInBundle,
  migrationName,
  PROJECT_REF,
  pendingMigrations,
  roleSql,
} from './lib/hosted-setup.mjs';

const { FormData } = globalThis; // Node 20+
const root = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const email = args[args.indexOf('--email') + 1];
const token = process.env.SUPABASE_ACCESS_TOKEN;
assertProject(PROJECT_REF);
if (!email || email.startsWith('--')) {
  console.error('usage: node scripts/hosted-setup.mjs --email you@example.com [--dry-run]');
  process.exit(1);
}
roleSql(email); // validates the email
if (!dry && !/^sbp_[A-Za-z0-9]{20,}$/.test(token ?? '')) {
  console.error('Set SUPABASE_ACCESS_TOKEN to a personal access token (sbp_…).');
  process.exit(1);
}

const api = (path) => `https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`;
async function call(method, path, body, form) {
  const r = await fetch(api(path), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(form ? {} : { 'content-type': 'application/json' }),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!r.ok)
    throw new Error(
      `${method} ${path.split('?')[0]} → HTTP ${r.status}: ${typeof json === 'string' ? json.slice(0, 200) : (json.message ?? 'error')}`,
    );
  return json;
}
const sql = (query) => call('POST', '/database/query', { query });
const step = (n, t) => console.log(`\n[${n}/5] ${t}`);

// ---- 0. project sanity
if (!dry) {
  const p = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!p.ok) {
    console.error(
      `Cannot read project ${PROJECT_REF} (HTTP ${p.status}). Is the token valid and from the account that owns it?`,
    );
    process.exit(1);
  }
  console.log(`project ${PROJECT_REF}: ${(await p.json()).status}`);
}

// ---- 1. migrations
step(1, 'migrations');
const files = readdirSync(join(root, 'supabase/migrations'));
// (dry run has no database to ask, so it pretends everything except the two newest migrations is already applied)
const sorted = files.filter((f) => f.endsWith('.sql')).sort();
const applied = dry
  ? sorted.slice(0, -2).map(migrationName)
  : (await sql('select name from supabase_migrations.schema_migrations')).map((r) => r.name);
const todo = pendingMigrations(files, applied);
if (todo.length > 3 && !args.includes('--allow-many')) {
  console.error(
    `${todo.length} migrations look pending, which is unexpected (names may not match the project's history). Aborting without changes; pass --allow-many only if you are sure.`,
  );
  process.exit(1);
}
console.log(todo.length ? 'pending: ' + todo.join(', ') : 'nothing pending');
for (const f of todo) {
  if (dry) continue;
  await call('POST', '/database/migrations', {
    name: migrationName(f),
    query: readFileSync(join(root, 'supabase/migrations', f), 'utf8'),
  });
  console.log('applied', f);
}

// ---- 2. functions
step(2, 'edge functions');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(includeInBundle);
console.log(`${tracked.length} files per bundle`);
for (const slug of FUNCTIONS) {
  if (dry) {
    console.log('would deploy', slug);
    continue;
  }
  const form = new FormData();
  form.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          entrypoint_path: `supabase/functions/${slug}/index.ts`,
          import_map_path: 'supabase/functions/deno.json',
          name: slug,
          verify_jwt: true,
        }),
      ],
      { type: 'application/json' },
    ),
  );
  for (const f of tracked) form.append('file', new Blob([readFileSync(join(root, f))]), f);
  const r = await call('POST', `/functions/deploy?slug=${slug}`, null, form);
  console.log(`deployed ${slug} v${r.version} (${r.status})`);
}

// ---- 3. email confirmation off (site_url is NOT touched)
step(3, 'email confirmation');
if (!dry) {
  const cfg = await call('GET', '/config/auth');
  if (cfg.mailer_autoconfirm === true) console.log('already off');
  else {
    await call('PATCH', '/config/auth', { mailer_autoconfirm: true });
    console.log('turned off');
  }
} else console.log('would turn off (mailer_autoconfirm = true)');

// ---- 4. roles
step(4, `roles for ${email}`);
if (!dry) {
  const out = await sql(roleSql(email));
  const s = out[out.length - 1] ?? out[0];
  console.log(JSON.stringify(s));
  if (!s || Number(s.accounts_found) === 0)
    console.log(
      'NOTE: no account with that email yet — sign up in the app first, then run this script again.',
    );
} else console.log('would grant admin, moderator and trusted creator');

// ---- 5. verify
step(5, 'verification');
if (!dry) {
  const v =
    await sql(`select (select count(*) from pg_proc where proname = 'delete_my_account') as delete_fn,
    (select pg_get_functiondef('app.content_visible'::regproc) like '%''none'',''cleared''%' and pg_get_functiondef('app.content_visible'::regproc) not like '%pending_review%') as pre_moderation,
    (select count(*) from supabase_migrations.schema_migrations) as migrations`);
  console.log(JSON.stringify(v[0]));
  const fns = await call('GET', '/functions');
  for (const f of fns.filter((x) => FUNCTIONS.includes(x.slug)))
    console.log(`${f.slug}: v${f.version} ${f.status} jwt=${f.verify_jwt}`);
} else console.log('dry run complete — nothing was changed');
