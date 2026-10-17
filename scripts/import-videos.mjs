#!/usr/bin/env node
// Uploads the launch reels through the app's own creator path, as YOUR account (no service key anywhere):
//   1. upload the mp4 to YOUR prefix of the private `media` bucket   2. register a `pending` media_assets row
//   3. call the `create-content` function, which verifies the upload and publishes the video.
//   LL_EMAIL=you@example.com LL_PASSWORD='…' EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_… \
//     node scripts/import-videos.mjs <folder-with-mp4s> [--dry-run]
// Progress is kept in <folder>/.import-videos.progress.json so a re-run never duplicates.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/import-videos.mjs <folder-with-mp4s> [--dry-run]');
  process.exit(1);
}
const { videos } = JSON.parse(
  readFileSync(new URL('../content/launch-videos.json', import.meta.url), 'utf8'),
);
const progressFile = join(dir, '.import-videos.progress.json');
const done = new Set(
  existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) : [],
);
const missing = videos.filter((v) => !existsSync(join(dir, v.file)));
if (missing.length) {
  console.error('Missing files in ' + dir + ':\n  ' + missing.map((v) => v.file).join('\n  '));
  process.exit(1);
}
const todo = videos.filter((v) => !done.has(v.file));
console.log(`${videos.length} videos, ${done.size} already imported, ${todo.length} to go`);
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
const { access_token: token, user } = await login.json();
const auth = { authorization: `Bearer ${token}`, apikey: ANON };

for (const v of todo) {
  const path = join(dir, v.file);
  const bytes = readFileSync(path);
  const key = `${user.id}/${randomUUID()}.mp4`;
  const up = await fetch(`${URL_}/storage/v1/object/media/${key}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'video/mp4' },
    body: bytes,
  });
  if (!up.ok) await fail(v, 'upload', up);
  const reg = await fetch(`${URL_}/rest/v1/media_assets`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({
      owner_user_id: user.id,
      bucket: 'media',
      storage_key: key,
      mime_type: 'video/mp4',
      size_bytes: statSync(path).size,
      duration_ms: v.durationMs,
      width: 1080,
      height: 1920,
    }),
  });
  if (!reg.ok) await fail(v, 'register', reg);
  const mediaId = (await reg.json())[0].id;
  const res = await fetch(`${URL_}/functions/v1/create-content`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'video',
      title: v.title,
      language: 'hi',
      conceptId: v.conceptId,
      difficulty: v.difficulty,
      body: { mediaId, durationMs: v.durationMs },
    }),
  });
  if (!res.ok) await fail(v, 'publish', res);
  const out = await res.json();
  done.add(v.file);
  writeFileSync(progressFile, JSON.stringify([...done]));
  console.log(
    `✓ ${v.file} → ${out.moderation === 'cleared' ? 'live' : 'waiting for moderator approval'}`,
  );
}
console.log('Done.');

async function fail(v, step, r) {
  console.error(`✗ ${v.file}: ${step} failed (HTTP ${r.status}) ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}
