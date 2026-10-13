#!/usr/bin/env node
// Imports a pack through the SAME path as the app's Create screen (`create-content` Edge Function), as YOUR account.
// Credentials are read from the environment at run time and never stored or printed.
//   LL_EMAIL=you@example.com LL_PASSWORD='…' node scripts/import-content-pack.mjs history-pack/pack.json [--dry-run]
// Upload limit is 20 posts/hour per account: the script waits and resumes automatically; progress is kept in <pack>.progress.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: node scripts/import-content-pack.mjs <pack.json> [--dry-run]');
  process.exit(1);
}
const pack = JSON.parse(readFileSync(file, 'utf8'));
const progressFile = file + '.progress.json';
const done = new Set(
  existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) : [],
);
const key = (it) => `${it.kind}|${it.language}|${it.title}`;
const todo = pack.items.filter((it) => !done.has(key(it)));
console.log(
  `${pack.items.length} items in pack, ${done.size} already imported, ${todo.length} to go`,
);
if (flags.includes('--dry-run')) process.exit(0);

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qwgsabpiqexfhndojckv.supabase.co';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!ANON || !/^sb_publishable_/.test(ANON)) {
  console.error(
    "Set EXPO_PUBLIC_SUPABASE_ANON_KEY to the project's PUBLISHABLE key (sb_publishable_…).",
  );
  process.exit(1);
}
if (!process.env.LL_EMAIL || !process.env.LL_PASSWORD) {
  console.error('Set LL_EMAIL and LL_PASSWORD (your Learning Loop account).');
  process.exit(1);
}

const login = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.LL_EMAIL, password: process.env.LL_PASSWORD }),
});
if (!login.ok) {
  console.error('Sign-in failed (HTTP ' + login.status + '). Check email/password.');
  process.exit(1);
}
const token = (await login.json()).access_token;

for (const it of todo) {
  for (;;) {
    const r = await fetch(`${URL_}/functions/v1/create-content`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        apikey: ANON,
        'content-type': 'application/json',
      },
      body: JSON.stringify(it),
    });
    if (r.status === 429) {
      console.log('upload limit reached — waiting 10 minutes…');
      await sleep(10 * 60_000);
      continue;
    }
    if (!r.ok) {
      console.error(
        `FAILED (${r.status}) ${it.kind}/${it.language}: ${it.title}\n${await r.text()}`,
      );
      process.exit(1);
    }
    const out = await r.json();
    done.add(key(it));
    writeFileSync(progressFile, JSON.stringify([...done]));
    console.log(`ok ${it.kind}/${it.language} ${out.moderation}: ${it.title}`);
    break;
  }
}
console.log('finished');
