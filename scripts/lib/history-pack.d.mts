export const IDS: Record<string, string>;
export const CONCEPT_OF: Record<string, string>;
export function questionSubmission(row: unknown): Record<string, unknown>;
export function noteSubmissions(unit: unknown): Record<string, unknown>[];
export function buildPack(input: { questions: unknown[]; units: unknown[] }): {
  count: number;
  items: Record<string, unknown>[];
};
export function curriculumSql(): string;
