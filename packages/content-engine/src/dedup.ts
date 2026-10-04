import { createHash } from 'node:crypto';

/** Cheap, deterministic duplicate detection: exact fingerprint + shingle Jaccard (no ML). */
export const normalizeText = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const fingerprint = (s: string): string =>
  createHash('sha256').update(normalizeText(s)).digest('hex');

export function shingles(s: string, k = 3): Set<string> {
  const w = normalizeText(s).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < k) {
    if (w.length) out.add(w.join(' '));
    return out;
  }
  for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DupMatch {
  id: string;
  similarity: number;
  exact: boolean;
}

export function findDuplicates(
  text: string,
  existing: { id: string; text: string }[],
  threshold = 0.8,
): DupMatch[] {
  const fp = fingerprint(text);
  const sh = shingles(text);
  const out: DupMatch[] = [];
  for (const e of existing) {
    if (fingerprint(e.text) === fp) {
      out.push({ id: e.id, similarity: 1, exact: true });
      continue;
    }
    const sim = jaccard(sh, shingles(e.text));
    if (sim >= threshold) out.push({ id: e.id, similarity: sim, exact: false });
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}

/** Question dedup key: prompt + sorted answer-bearing fields so re-worded options still match. */
export const questionText = (q: { prompt: string; options?: { text: string }[] }): string =>
  [q.prompt, ...(q.options ?? []).map((o) => o.text).sort()].join(' | ');
