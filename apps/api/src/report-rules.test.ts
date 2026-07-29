import { describe, expect, it } from 'vitest';
import type { GstReturnExtraction, ReportRow } from '@itr/contracts';
import {
  compareAmounts,
  derivePanFromGstin,
  displayFilingType,
  expectedGstr1OutwardValue,
  normalizeToRupees,
  selectLatestItrRows
} from './report-rules.js';

const row = (value: Partial<ReportRow>): ReportRow => ({
  acknowledgementNumber: '111111111111111',
  filingDate: '2025-07-31',
  filingType: 'ORIGINAL',
  assessmentYear: '2024-25',
  totalIncome: 100,
  totalTaxInterestFeePayable: 10,
  totalTaxesPaid: 10,
  ...value
});

describe('ITR report rules', () => {
  it('uses the latest revised filing and keeps assessment years newest first', () => {
    const selected = selectLatestItrRows([
      row({ acknowledgementNumber: '100000000000001', filingDate: '2024-07-26', filingType: 'ORIGINAL' }),
      row({ acknowledgementNumber: '100000000000002', filingDate: '2025-01-02', filingType: 'REVISED', totalIncome: 2203600 }),
      row({ acknowledgementNumber: '100000000000003', assessmentYear: '2025-26', filingDate: '2025-09-15' })
    ]);

    expect(selected.map((value) => value.assessmentYear)).toEqual(['2025-26', '2024-25']);
    expect(selected[1].acknowledgementNumber).toBe('100000000000002');
    expect(selected[1].totalIncome).toBe(2203600);
  });

  it('maps section 139(4) output to Belated Return wording', () => {
    expect(displayFilingType('BELATED')).toBe('Belated Return');
  });
});

describe('GST and financial rules', () => {
  it('derives the company PAN from a state GSTIN', () => {
    expect(derivePanFromGstin('27AABCC5972B1ZU')).toBe('AABCC5972B');
  });

  it('preserves negative credit notes in final GSTR-1 outward value', () => {
    const value = {
      taxableOutwardValue: 292000,
      zeroRatedOutwardValue: 0,
      exemptNilOutwardValue: 56712755.08,
      nonGstOutwardValue: 0,
      reverseChargeOutwardValue: 12422141,
      amendmentDifferentialValue: 0,
      creditDebitNoteValue: -230000
    } as GstReturnExtraction;

    expect(expectedGstr1OutwardValue(value)).toBeCloseTo(69196896.08, 2);
  });

  it('normalizes source units and accepts only the configured rounding tolerance', () => {
    expect(normalizeToRupees(44401, 'HUNDREDS')).toBe(4440100);
    expect(normalizeToRupees(440, 'LAKHS')).toBe(44000000);
    expect(compareAmounts(110606015, 110606014, 1).status).toBe('ROUNDING_ACCEPTED');
    expect(compareAmounts(110606015, 110606013, 1).status).toBe('MISMATCH');
  });
});
