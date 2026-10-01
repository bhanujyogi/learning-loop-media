import { z } from 'zod';
import {
  CONTENT_TYPES,
  FORMAT_TYPES,
  FRESHNESS_STATUSES,
  HOOK_TYPES,
  LICENSE_CODES,
  OWNERSHIP_KINDS,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
} from '@learning-loop/shared';

export const CONTENT_SCHEMA_VERSION = 'content_schema_v1';

const id = z.string().min(1).max(64);
const unit = z.number().min(0).max(1);
const text = (max = 2000) => z.string().trim().min(1).max(max);

/** Language-tagged so content can be multilingual later (BCP-47-ish). */
export const languageCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

// ---------- Notes: structured blocks (no raw HTML) ----------
export const noteBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), level: z.number().int().min(1).max(4), text: text(200) }),
  z.object({ type: z.literal('paragraph'), text: text(5000) }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean().default(false),
    items: z.array(text(1000)).min(1).max(50),
  }),
  z.object({
    type: z.literal('table'),
    header: z.array(text(200)).min(1).max(12),
    rows: z.array(z.array(z.string().max(500)).max(12)).max(100),
  }),
  z.object({ type: z.literal('formula'), latex: text(500) }),
  z.object({
    type: z.literal('image'),
    mediaId: id,
    alt: text(300),
    caption: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('concept_link'), conceptId: id, label: text(200) }),
  z.object({ type: z.literal('revision_prompt'), prompt: text(500) }),
  z.object({
    type: z.literal('callout'),
    kind: z.enum(['tip', 'warning', 'misconception', 'example']),
    text: text(2000),
  }),
]);
export const noteBody = z.object({ blocks: z.array(noteBlock).min(1).max(300) });

// ---------- Video / media-backed content ----------
export const videoBody = z.object({
  mediaId: id,
  posterMediaId: id.optional(),
  captionsMediaId: id.optional(),
  durationMs: z
    .number()
    .int()
    .min(1000)
    .max(15 * 60_000),
  transcript: z.string().max(20_000).optional(),
});

// ---------- Questions ----------
const option = z.object({ id: id, text: text(500), mediaId: id.optional() });
const questionBase = z.object({
  prompt: text(2000),
  explanation: text(4000),
  mediaId: id.optional(),
  hint: z.string().max(500).optional(),
  expectedSeconds: z.number().int().min(1).max(600).optional(),
});

const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;

export const questionBody = z
  .discriminatedUnion('type', [
    questionBase.extend({
      type: z.enum(['single_choice', 'image_based', 'application']),
      options: z.array(option).min(2).max(8),
      answer: z.object({ optionId: id }),
    }),
    questionBase.extend({
      type: z.literal('multi_choice'),
      options: z.array(option).min(3).max(10),
      answer: z.object({ optionIds: z.array(id).min(1) }),
    }),
    questionBase.extend({
      type: z.literal('true_false'),
      answer: z.object({ value: z.boolean() }),
    }),
    questionBase.extend({
      type: z.literal('fill_blank'),
      answer: z.object({
        accepted: z.array(text(200)).min(1).max(20),
        caseSensitive: z.boolean().default(false),
      }),
    }),
    questionBase.extend({
      type: z.literal('numerical'),
      answer: z.object({
        value: z.number(),
        tolerance: z.number().min(0).default(0),
        unit: z.string().max(30).optional(),
      }),
    }),
    questionBase.extend({
      type: z.literal('matching'),
      left: z.array(option).min(2).max(10),
      right: z.array(option).min(2).max(10),
      answer: z.object({ pairs: z.array(z.object({ left: id, right: id })).min(2) }),
    }),
    questionBase.extend({
      type: z.literal('ordering'),
      items: z.array(option).min(2).max(10),
      answer: z.object({ order: z.array(id).min(2) }),
    }),
    questionBase.extend({
      type: z.literal('map_based'),
      interactiveId: id,
      answer: z.object({ regionId: id }),
    }),
  ])
  .superRefine((q, ctx) => {
    const bad = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    if ('options' in q) {
      if (!uniqueIds(q.options.map((o) => o.id))) bad('duplicate option ids', ['options']);
      if (q.type === 'multi_choice') {
        if (!q.answer.optionIds.every((x) => q.options.some((o) => o.id === x)))
          bad('answer references unknown option', ['answer']);
        if (!uniqueIds(q.answer.optionIds)) bad('duplicate answer ids', ['answer']);
        if (q.answer.optionIds.length >= q.options.length)
          bad('all options correct is ambiguous', ['answer']);
      } else if ('optionId' in q.answer && !q.options.some((o) => o.id === q.answer.optionId)) {
        bad('answer references unknown option', ['answer']);
      }
    }
    if (q.type === 'matching') {
      const L = new Set(q.left.map((o) => o.id)),
        R = new Set(q.right.map((o) => o.id));
      if (!uniqueIds(q.left.map((o) => o.id)) || !uniqueIds(q.right.map((o) => o.id)))
        bad('duplicate ids', ['left']);
      if (!q.answer.pairs.every((p) => L.has(p.left) && R.has(p.right)))
        bad('pair references unknown id', ['answer']);
      if (!uniqueIds(q.answer.pairs.map((p) => p.left))) bad('left side matched twice', ['answer']);
    }
    if (q.type === 'ordering') {
      const ids = q.items.map((o) => o.id);
      if (!uniqueIds(ids)) bad('duplicate item ids', ['items']);
      if (
        q.answer.order.length !== ids.length ||
        !q.answer.order.every((x) => ids.includes(x)) ||
        !uniqueIds(q.answer.order)
      )
        bad('order must be a permutation of items', ['answer']);
    }
  });
export type QuestionBody = z.infer<typeof questionBody>;

// ---------- Flashcards / Quiz ----------
export const flashcardBody = z.object({
  front: text(1000),
  back: text(2000),
  frontMediaId: id.optional(),
  backMediaId: id.optional(),
});
export const quizBody = z.object({
  items: z
    .array(z.object({ questionId: id, points: z.number().min(0).max(100).default(1) }))
    .min(1)
    .max(100),
  timeLimitSeconds: z.number().int().min(10).max(14_400).optional(),
  shuffle: z.boolean().default(true),
});

// ---------- Interactive (data-driven; see docs/INTERACTIVE_CONTENT.md) ----------
export const interactiveDefinition = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('tap_reveal'),
      items: z
        .array(z.object({ id, label: text(200), reveal: text(1000) }))
        .min(1)
        .max(20),
    }),
    z.object({
      kind: z.literal('matching'),
      left: z.array(option).min(2).max(10),
      right: z.array(option).min(2).max(10),
      pairs: z.array(z.object({ left: id, right: id })).min(2),
    }),
    z.object({
      kind: z.literal('ordering'),
      items: z.array(option).min(2).max(10),
      order: z.array(id).min(2),
    }),
    z.object({
      kind: z.literal('timeline'),
      events: z
        .array(
          z.object({
            id,
            label: text(200),
            year: z.number().int(),
            detail: z.string().max(1000).optional(),
          }),
        )
        .min(2)
        .max(40),
    }),
    z.object({
      kind: z.literal('diagram'),
      mediaId: id,
      hotspots: z
        .array(
          z.object({
            id,
            x: unit,
            y: unit,
            label: text(200),
            detail: z.string().max(1000).optional(),
          }),
        )
        .min(1)
        .max(30),
    }),
    z.object({
      kind: z.literal('map'),
      viewBox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
      regions: z
        .array(
          z.object({
            id,
            name: text(200),
            path: z
              .string()
              .min(3)
              .max(20_000)
              .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/, 'invalid SVG path data'),
            capital: z.string().max(100).optional(),
            info: z.string().max(1000).optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.kind === 'ordering') {
      const ids = d.items.map((o) => o.id);
      if (
        d.order.length !== ids.length ||
        !d.order.every((x) => ids.includes(x)) ||
        !uniqueIds(d.order)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'order must be a permutation of items',
          path: ['order'],
        });
    }
    if (d.kind === 'matching') {
      const L = new Set(d.left.map((o) => o.id)),
        R = new Set(d.right.map((o) => o.id));
      if (!d.pairs.every((p) => L.has(p.left) && R.has(p.right)))
        ctx.addIssue({ code: 'custom', message: 'pair references unknown id', path: ['pairs'] });
    }
  });
export type InteractiveDefinition = z.infer<typeof interactiveDefinition>;

// ---------- Content item envelope ----------
export const contentEnvelope = z.object({
  type: z.enum(CONTENT_TYPES),
  title: text(200),
  language: languageCode,
  ownership: z.enum(OWNERSHIP_KINDS),
  sourceType: z.enum(SOURCE_TYPES),
  verification: z.enum(VERIFICATION_STATUSES).default('unverified'),
  freshness: z.enum(FRESHNESS_STATUSES).default('current'),
  hook: z.enum(HOOK_TYPES).optional(),
  format: z.enum(FORMAT_TYPES).optional(),
  difficulty: unit.optional(),
  expectedSeconds: z.number().int().min(1).max(7200).optional(),
  learningObjective: z.string().max(500).optional(),
  conceptIds: z.array(id).max(20).default([]),
  examIds: z.array(id).max(20).default([]),
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION).default(CONTENT_SCHEMA_VERSION),
});
export type ContentEnvelope = z.infer<typeof contentEnvelope>;

// ---------- Provenance ----------
export const licenseTerms = z.object({
  license: z.enum(LICENSE_CODES),
  licenseUrl: z.string().url().optional(),
  attributionRequired: z.boolean(),
  commercialUseAllowed: z.boolean().nullable(), // null = unknown
  redistributionAllowed: z.boolean().nullable(),
  modificationAllowed: z.boolean().nullable(),
});
export type LicenseTerms = z.infer<typeof licenseTerms>;

export const provenanceSource = z.object({
  sourceId: id,
  sourceUrl: z.string().url(),
  sourceName: text(300),
  publisher: z.string().max(300).optional(),
  author: z.string().max(300).optional(),
  retrievedAt: z.string().datetime(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  terms: licenseTerms,
});
export type ProvenanceSource = z.infer<typeof provenanceSource>;

export const generationRecord = z.object({
  generatedBy: z.enum(['human', 'pipeline', 'model']),
  modelIdentifier: z.string().max(200).optional(),
  modelVersion: z.string().max(100).optional(),
  promptVersion: z.string().max(100).optional(),
  processName: z.string().max(200).optional(),
  generatedAt: z.string().datetime(),
});
export type GenerationRecord = z.infer<typeof generationRecord>;

export const provenanceRecord = z.object({
  sources: z.array(provenanceSource).max(50),
  transformation: z.string().max(1000).optional(),
  generation: generationRecord,
  contentVersion: z.number().int().min(1),
});
export type ProvenanceRecord = z.infer<typeof provenanceRecord>;
