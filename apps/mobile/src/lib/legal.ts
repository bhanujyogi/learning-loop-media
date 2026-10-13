import operator from '../legal/operator.json';
import guidelines from '../legal/guidelines.json';
import privacy from '../legal/privacy.json';
import terms from '../legal/terms.json';

export const LEGAL_DOCS = { privacy, terms, guidelines } as const;
export type LegalDocId = keyof typeof LEGAL_DOCS;
export const isLegalDoc = (x: unknown): x is LegalDocId => typeof x === 'string' && x in LEGAL_DOCS;

export interface LegalDoc {
  title: string;
  updated: string;
  sections: { h: string; p: string[] }[];
}
/** Fills {{OPERATOR}} / {{CONTACT}} / {{JURISDICTION}} from operator.json. */
export function fillOperator(text: string, op: Record<string, string> = operator): string {
  return text
    .replaceAll('{{OPERATOR}}', op.operator ?? '')
    .replaceAll('{{CONTACT}}', op.contact ?? '')
    .replaceAll('{{JURISDICTION}}', op.jurisdiction ?? '');
}
export function renderLegal(id: LegalDocId, op: Record<string, string> = operator): LegalDoc {
  const d = LEGAL_DOCS[id];
  return {
    title: d.title,
    updated: d.updated,
    sections: d.sections.map((s) => ({ h: s.h, p: s.p.map((x) => fillOperator(x, op)) })),
  };
}
/** True while any operator detail is still a placeholder — a release gate (scripts/check-release.mjs) refuses to ship then. */
export const operatorIncomplete = (op: Record<string, string> = operator) =>
  Object.values(op).some((v) => !v || /\{\{.*\}\}/.test(v));
