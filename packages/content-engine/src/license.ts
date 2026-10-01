import type { LicenseCode } from '@learning-loop/shared';
import type { LicenseTerms, ProvenanceSource } from '@learning-loop/validation';

/**
 * Access ≠ reuse rights. This module answers only: "may Learning Loop redistribute a derivative
 * of this source commercially?". Anything not explicitly allowed → flag_for_review (never assume).
 */
export type LicenseDecision =
  | { decision: 'allow'; attribution: boolean; shareAlike: boolean; reasons: string[] }
  | { decision: 'flag_for_review'; reasons: string[] }
  | { decision: 'reject'; reasons: string[] };

export interface Intent {
  /** Do we modify/transform the source (notes, questions derived from it)? default true */
  modify: boolean;
  /** Is the product commercial (ads/subscriptions)? default true — be conservative. */
  commercial: boolean;
}
export const DEFAULT_INTENT: Intent = { modify: true, commercial: true };

const OPEN: Partial<Record<LicenseCode, { attribution: boolean; shareAlike: boolean }>> = {
  public_domain: { attribution: false, shareAlike: false },
  cc0: { attribution: false, shareAlike: false },
  cc_by: { attribution: true, shareAlike: false },
  cc_by_sa: { attribution: true, shareAlike: true },
  open_government: { attribution: true, shareAlike: false },
  mit: { attribution: true, shareAlike: false },
  apache_2: { attribution: true, shareAlike: false },
};

export function evaluateLicense(t: LicenseTerms, intent: Intent = DEFAULT_INTENT): LicenseDecision {
  const reasons: string[] = [];
  if (t.license === 'proprietary')
    return { decision: 'reject', reasons: ['proprietary license: reuse not granted'] };
  if (t.license === 'unknown') return { decision: 'flag_for_review', reasons: ['license unknown'] };
  if (t.license === 'cc_by_nc' || t.license === 'cc_by_nc_sa' || t.license === 'cc_by_nc_nd')
    return {
      decision: 'reject',
      reasons: ['non-commercial license incompatible with a commercial product'],
    };
  if (t.license === 'cc_by_nd' && intent.modify)
    return { decision: 'reject', reasons: ['no-derivatives license but we transform content'] };

  const open = OPEN[t.license];
  if (!open) return { decision: 'flag_for_review', reasons: [`unrecognised license ${t.license}`] };

  // Explicit "false" flags override a recognised license label (record contradicts label).
  if (t.redistributionAllowed === false) reasons.push('redistribution explicitly disallowed');
  if (intent.commercial && t.commercialUseAllowed === false)
    reasons.push('commercial use explicitly disallowed');
  if (intent.modify && t.modificationAllowed === false)
    reasons.push('modification explicitly disallowed');
  if (reasons.length) return { decision: 'reject', reasons };

  // Open license but flags unknown → we want explicit rights recorded.
  const unknown: string[] = [];
  if (t.redistributionAllowed === null) unknown.push('redistribution right not recorded');
  if (intent.commercial && t.commercialUseAllowed === null)
    unknown.push('commercial-use right not recorded');
  if (intent.modify && t.modificationAllowed === null)
    unknown.push('modification right not recorded');
  if (!t.licenseUrl && t.license !== 'public_domain') unknown.push('license URL missing');
  if (unknown.length) return { decision: 'flag_for_review', reasons: unknown };

  return {
    decision: 'allow',
    attribution: open.attribution || t.attributionRequired,
    shareAlike: open.shareAlike,
    reasons: [],
  };
}

/** Combine across contributing sources: worst decision wins. */
export function evaluateSources(
  sources: ProvenanceSource[],
  intent: Intent = DEFAULT_INTENT,
): LicenseDecision {
  if (sources.length === 0)
    return { decision: 'allow', attribution: false, shareAlike: false, reasons: [] };
  const results = sources.map((s) => ({ s, d: evaluateLicense(s.terms, intent) }));
  const rejected = results.filter((r) => r.d.decision === 'reject');
  if (rejected.length)
    return {
      decision: 'reject',
      reasons: rejected.flatMap((r) => r.d.reasons.map((x) => `${r.s.sourceId}: ${x}`)),
    };
  const flagged = results.filter((r) => r.d.decision === 'flag_for_review');
  if (flagged.length)
    return {
      decision: 'flag_for_review',
      reasons: flagged.flatMap((r) => r.d.reasons.map((x) => `${r.s.sourceId}: ${x}`)),
    };
  return {
    decision: 'allow',
    attribution: results.some((r) => r.d.decision === 'allow' && r.d.attribution),
    shareAlike: results.some((r) => r.d.decision === 'allow' && r.d.shareAlike),
    reasons: [],
  };
}
