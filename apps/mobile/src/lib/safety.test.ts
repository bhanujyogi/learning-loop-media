import { describe, expect, it } from 'vitest';
import { deleteOutcome, REPORT_REASONS, reportOutcome } from './safety';
import { fillOperator, LEGAL_DOCS, operatorIncomplete, renderLegal } from './legal';
import { en } from '../i18n/en';

describe('report and delete outcomes', () => {
  it('maps database errors to what the learner is told', () => {
    expect(reportOutcome(null)).toBe('sent');
    expect(reportOutcome({ code: '23505' })).toBe('already');
    expect(reportOutcome({ code: '54000' })).toBe('rate');
    expect(reportOutcome({ message: 'rate_limited: report_submit' })).toBe('rate');
    expect(reportOutcome({ code: '42501' })).toBe('failed');
    expect(deleteOutcome(null)).toBe('deleted');
    expect(
      deleteOutcome({ code: '42501', message: 'staff accounts cannot be deleted from the app' }),
    ).toBe('staff');
    expect(deleteOutcome({ code: 'PGRST301' })).toBe('failed');
  });
  it('every report reason the database accepts has a localized label', () => {
    for (const r of REPORT_REASONS) expect(en).toHaveProperty(`report.reason.${r}`);
  });
});

describe('legal documents', () => {
  const op = {
    operator: 'Acme Learning Pvt Ltd',
    contact: 'help@example.com',
    jurisdiction: 'India',
  };
  it('placeholders are filled and none are left over once operator details exist', () => {
    for (const id of Object.keys(LEGAL_DOCS) as (keyof typeof LEGAL_DOCS)[]) {
      const d = renderLegal(id, op);
      expect(JSON.stringify(d)).not.toMatch(/\{\{/);
      expect(d.sections.length).toBeGreaterThan(3);
    }
    expect(fillOperator('Contact {{CONTACT}}', op)).toBe('Contact help@example.com');
  });
  it('the release gate trips while operator details are placeholders or blank', () => {
    expect(operatorIncomplete(op)).toBe(false);
    expect(operatorIncomplete({ ...op, contact: '' })).toBe(true);
    expect(operatorIncomplete({ ...op, operator: '{{OPERATOR}}' })).toBe(true);
  });
  it('the policy states the facts the app depends on (18+, in-app deletion, review before visibility, no ads)', () => {
    const all = JSON.stringify(LEGAL_DOCS).toLowerCase();
    for (const must of [
      '18',
      'delete my account',
      'reviewed',
      'do not show advertising',
      'copyright',
    ])
      expect(all, must).toContain(must);
  });
});
