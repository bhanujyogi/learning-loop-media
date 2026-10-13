export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate',
  'misinformation',
  'copyright',
  'self_harm',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportOutcome = 'sent' | 'already' | 'rate' | 'failed';
/** Interprets the result of inserting a report (unique violation = already reported; 54000 = rate limited). */
export function reportOutcome(error: { code?: string; message?: string } | null): ReportOutcome {
  if (!error) return 'sent';
  if (error.code === '23505') return 'already';
  if (error.code === '54000' || /rate_limited/.test(error.message ?? '')) return 'rate';
  return 'failed';
}

/** Account deletion: a staff account is refused by the database (42501 + "staff"). */
export type DeleteOutcome = 'deleted' | 'staff' | 'failed';
export function deleteOutcome(error: { code?: string; message?: string } | null): DeleteOutcome {
  if (!error) return 'deleted';
  if (error.code === '42501' && /staff/i.test(error.message ?? '')) return 'staff';
  return 'failed';
}
