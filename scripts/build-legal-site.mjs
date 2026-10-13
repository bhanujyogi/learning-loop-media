#!/usr/bin/env node
// Builds static web pages (Privacy policy, Terms, Community guidelines) from the same JSON the app shows.
// Google Play requires a public privacy-policy URL: host the output folder anywhere (Netlify drop, GitHub Pages, …).
// Usage: node scripts/build-legal-site.mjs [--draft]   → ./legal-site/*.html   (--draft allows unfilled operator details)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dir = join(root, 'apps/mobile/src/legal');
const op = JSON.parse(readFileSync(join(dir, 'operator.json'), 'utf8'));
const incomplete = Object.values(op).some((v) => !v || /\{\{.*\}\}/.test(v));
if (incomplete && !process.argv.includes('--draft')) {
  console.error(
    'operator.json still has placeholders. Fill operator/contact/jurisdiction, or pass --draft for a preview.',
  );
  process.exit(1);
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (s) =>
  s
    .replaceAll('{{OPERATOR}}', op.operator)
    .replaceAll('{{CONTACT}}', op.contact)
    .replaceAll('{{JURISDICTION}}', op.jurisdiction);
const docs = { privacy: 'privacy.json', terms: 'terms.json', guidelines: 'guidelines.json' };
const css = `:root{color-scheme:light dark}body{font:17px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:#14142b;background:#f7f7fb}
@media(prefers-color-scheme:dark){body{color:#f4f4ff;background:#0e0e1a}a{color:#8b85ff}}h1{font-size:2rem}h2{margin-top:2rem}nav a{margin-right:16px}`;
const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} – Learning Loop</title><style>${css}</style></head><body><nav><a href="index.html">Learning Loop</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="guidelines.html">Guidelines</a></nav>${body}</body></html>`;
mkdirSync(join(root, 'legal-site'), { recursive: true });
for (const [id, file] of Object.entries(docs)) {
  const d = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const body =
    `<h1>${esc(d.title)}</h1><p><small>Last updated ${d.updated}${incomplete ? ' — DRAFT PREVIEW, operator details missing' : ''}</small></p>` +
    d.sections
      .map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((p) => `<p>${esc(fill(p))}</p>`).join('')}`)
      .join('');
  writeFileSync(join(root, 'legal-site', `${id}.html`), page(d.title, body));
}
writeFileSync(
  join(root, 'legal-site', 'index.html'),
  page(
    'Learning Loop',
    `<h1>Learning Loop</h1><p>Practice questions, notes and flashcards for competitive exams.</p><ul><li><a href="privacy.html">Privacy policy</a></li><li><a href="terms.html">Terms of use</a></li><li><a href="guidelines.html">Community guidelines</a></li></ul>`,
  ),
);
console.log(
  'wrote legal-site/ (index, privacy, terms, guidelines)' + (incomplete ? ' [DRAFT]' : ''),
);
