import {
  contentEnvelope,
  provenanceRecord,
  questionBody,
  noteBody,
  flashcardBody,
  quizBody,
  interactiveDefinition,
  type ProvenanceRecord,
} from '@learning-loop/validation';
import type { ZodType } from 'zod';
import { evaluateSources, type Intent } from './license';
import { findDuplicates } from './dedup';

/** Configurable publication quality gates (docs/CONTENT_INGESTION.md §Quality gates). */
export const GATE_NAMES = [
  'schema_valid',
  'source_valid',
  'license_valid',
  'metadata_valid',
  'answer_keys_valid',
  'duplicate_check_passed',
  'content_quality_check_passed',
] as const;
export type GateName = (typeof GATE_NAMES)[number];

export interface GateResult {
  gate: GateName;
  passed: boolean;
  messages: string[];
}
export interface GateReport {
  passed: boolean;
  results: GateResult[];
  failed: GateName[];
}

export interface ContentCandidate {
  envelope: unknown;
  body: unknown;
  provenance?: unknown;
  /** existing published texts for duplicate detection */
  existing?: { id: string; text: string }[];
  /** text used for duplicate/quality checks */
  text?: string;
}

const BODY_SCHEMAS: Record<string, ZodType> = {
  note: noteBody,
  question: questionBody,
  flashcard: flashcardBody,
  quiz: quizBody,
  interactive: interactiveDefinition,
};

export interface GateOptions {
  required: GateName[];
  intent?: Intent;
  /** official/imported content must carry provenance with ≥1 source or an explicit human/model origin */
  requireProvenanceForOfficial: boolean;
  duplicateThreshold: number;
}
export const DEFAULT_GATES: GateOptions = {
  required: [...GATE_NAMES],
  requireProvenanceForOfficial: true,
  duplicateThreshold: 0.8,
};

const fmt = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`);

export function runGates(c: ContentCandidate, opts: GateOptions = DEFAULT_GATES): GateReport {
  const results: GateResult[] = [];
  const add = (gate: GateName, passed: boolean, messages: string[] = []) =>
    results.push({ gate, passed, messages });

  const env = contentEnvelope.safeParse(c.envelope);
  const type = env.success ? env.data.type : undefined;
  const bodySchema = type ? BODY_SCHEMAS[type] : undefined;
  const body = bodySchema ? bodySchema.safeParse(c.body) : undefined;

  add('schema_valid', env.success && (!bodySchema || !!body?.success), [
    ...(env.success ? [] : fmt(env.error)),
    ...(body && !body.success ? fmt(body.error) : []),
  ]);

  // metadata: objectives/concepts/difficulty required for official learning objects
  const metaMsgs: string[] = [];
  if (env.success) {
    const e = env.data;
    if (e.ownership === 'official') {
      if (!e.conceptIds.length) metaMsgs.push('official content must map to ≥1 concept');
      if (!e.examIds.length) metaMsgs.push('official content must map to ≥1 exam');
      if (e.difficulty === undefined) metaMsgs.push('difficulty required');
      if (e.type !== 'video' && !e.learningObjective) metaMsgs.push('learningObjective required');
    }
  } else metaMsgs.push('envelope invalid');
  add('metadata_valid', metaMsgs.length === 0, metaMsgs);

  const prov = c.provenance === undefined ? undefined : provenanceRecord.safeParse(c.provenance);
  const needsProv =
    env.success && opts.requireProvenanceForOfficial && env.data.ownership === 'official';
  const srcMsgs: string[] = [];
  if (prov && !prov.success) srcMsgs.push(...fmt(prov.error));
  if (needsProv && !prov) srcMsgs.push('official content requires provenance');
  if (env.success && prov?.success) {
    const p: ProvenanceRecord = prov.data;
    if (env.data.sourceType === 'imported' && p.sources.length === 0)
      srcMsgs.push('imported content must list ≥1 source');
    if (
      (env.data.sourceType === 'ai_generated' || env.data.sourceType === 'ai_assisted') &&
      !(
        p.generation.generatedBy === 'model' &&
        p.generation.modelIdentifier &&
        p.generation.promptVersion
      )
    )
      srcMsgs.push('AI content must record model identifier and prompt version');
  }
  add('source_valid', srcMsgs.length === 0, srcMsgs);

  const lic = prov?.success
    ? evaluateSources(prov.data.sources, opts.intent)
    : { decision: 'allow' as const, reasons: [] as string[] };
  add(
    'license_valid',
    lic.decision === 'allow',
    lic.decision === 'allow' ? [] : [`${lic.decision}: ${lic.reasons.join('; ')}`],
  );

  // Answer keys: structural validity already enforced by schema; here we ensure explanation consistency basics.
  const keyMsgs: string[] = [];
  if (env.success && env.data.type === 'question') {
    if (!body?.success) keyMsgs.push('question body invalid');
    else {
      const q = body.data as { explanation: string };
      if (q.explanation.trim().length < 20)
        keyMsgs.push('explanation too short to justify the answer');
    }
  }
  add('answer_keys_valid', keyMsgs.length === 0, keyMsgs);

  const dups =
    c.text && c.existing ? findDuplicates(c.text, c.existing, opts.duplicateThreshold) : [];
  add(
    'duplicate_check_passed',
    dups.length === 0,
    dups
      .slice(0, 3)
      .map(
        (d) => `${d.exact ? 'exact' : 'near'} duplicate of ${d.id} (${d.similarity.toFixed(2)})`,
      ),
  );

  const qMsgs: string[] = [];
  if (env.success && c.text !== undefined) {
    if (c.text.trim().length < 20) qMsgs.push('content too short');
    if (/lorem ipsum|TODO|FIXME/i.test(c.text)) qMsgs.push('placeholder text detected');
  }
  add('content_quality_check_passed', qMsgs.length === 0, qMsgs);

  const failed = results
    .filter((r) => opts.required.includes(r.gate) && !r.passed)
    .map((r) => r.gate);
  return { passed: failed.length === 0, results, failed };
}
