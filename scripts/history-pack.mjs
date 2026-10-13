#!/usr/bin/env node
// Usage: node scripts/history-pack.mjs <folder-with-questions.jsonl-and-units.jsonl> [outDir]
// Writes <outDir>/pack.json (creator submissions) and <outDir>/curriculum.sql. Nothing is uploaded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPack, curriculumSql } from './lib/history-pack.mjs';

const [dir, out = './history-pack'] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/history-pack.mjs <pilot folder> [outDir]');
  process.exit(1);
}
const jsonl = (f) =>
  readFileSync(join(resolve(dir), f), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const pack = buildPack({ questions: jsonl('questions.jsonl'), units: jsonl('units.jsonl') });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'pack.json'), JSON.stringify(pack, null, 2));
writeFileSync(join(out, 'curriculum.sql'), curriculumSql());
console.log(`wrote ${out}/pack.json (${pack.count} items) and ${out}/curriculum.sql`);
