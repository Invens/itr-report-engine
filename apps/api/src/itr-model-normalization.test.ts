import { describe, expect, it } from 'vitest';
import { itrExtractionSchema } from '@itr/contracts';
import './itr-schema-normalization.js';

describe('ITR acknowledgement model normalization', () => {
  it('normalizes Sankalp Jain revised-return aliases and table-row contamination', () => {
    const parsed = itrExtractionSchema.parse({
      documentType: 'ITR_ACKNOWLEDGEMENT',
      originalName: 'ITR-SANKALP JAIN AY 2024-25.pdf',
      acknowledgementNumber: '802625790020125',
      dateOfFiling: '2025-01-02',
      assessmentYear: '2024-25',
      pan: 'ALQPJ4174K',
      name: 'SANKALP JAIN',
      status: 'Individual',
      formNumber: 'ITR-3',
      filedUnderSection: 'REVISED',
      originalAcknowledgementNumber: null,
      currentYearBusinessLoss: 10,
      totalIncome: 22203600,
      totalTaxInterestAndFeePayable: 7375523,
      taxesPaid: 8513697,
      taxPayableOrRefundable: -138170,
      taxCredits: {
        total: 0,
        tds: 0,
        tcs: 0,
        advanceTax: 0,
        selfAssessmentTax: 0
      },
      relationships: [],
      auditRecords: [],
      statementValues: [],
      provenance: [],
      evidence: [
        {
          field: 'acknowledgementNumber',
          snippet: 'Acknowledgement Number:802625790020125',
          confidence: 1
        },
        {
          field: 'dateOfFiling',
          snippet: 'Date of filing : 02-Jan-2025',
          confidence: 1
        },
        { field: 'pan', snippet: 'PANALQPJ4174K', confidence: 1 },
        { field: 'name', snippet: 'NameSANKALP JAIN', confidence: 1 },
        { field: 'totalIncome', snippet: 'Total Income222,03,600', confidence: 1 },
        {
          field: 'netTaxPayable',
          snippet: 'Net tax payable53,75,523',
          confidence: 1
        },
        {
          field: 'interestAndFeePayable',
          snippet: 'Interest and Fee Payable60',
          confidence: 0.8
        },
        {
          field: 'totalTaxInterestAndFeePayable',
          snippet: 'Total tax, interest and Fee payable73,75,523',
          confidence: 1
        },
        { field: 'taxesPaid', snippet: 'Taxes Paid85,13,697', confidence: 1 },
        {
          field: 'taxPayableOrRefundable',
          snippet: '(+) Tax Payable /(-) Refundable (7-8)9(-) 1,38,170',
          confidence: 1
        },
        {
          field: 'filedUnderSection',
          snippet: 'Filed u/s139(5)- Revised Return',
          confidence: 1
        }
      ]
    });

    expect(parsed.entityType).toBe('INDIVIDUAL');
    expect(parsed.formType).toBe('ITR-3');
    expect(parsed.filingDate).toBe('2025-01-02');
    expect(parsed.filingSection).toBe('139(5)');
    expect(parsed.filingType).toBe('REVISED');
    expect(parsed.currentYearBusinessLoss).toBe(0);
    expect(parsed.totalIncome).toBe(2_203_600);
    expect(parsed.totalTaxInterestFeePayable).toBe(375_523);
    expect(parsed.totalTaxesPaid).toBe(513_697);
    expect(parsed.refundOrDemand).toBe(-138_170);
    expect(parsed.originalAcknowledgementNumber).toBeUndefined();
    expect(parsed.evidence).toMatchObject({
      filingDate: 'Date of filing : 02-Jan-2025',
      totalTaxInterestFeePayable: 'Total tax, interest and Fee payable73,75,523',
      totalTaxesPaid: 'Taxes Paid85,13,697'
    });
    expect(parsed.confidence.filingDate).toBe(1);
    expect(parsed.confidence.assessmentYear).toBe(0.5);
  });

  it('maps section 139(4) to BELATED instead of REVISED', () => {
    const parsed = itrExtractionSchema.parse({
      documentType: 'ITR_ACKNOWLEDGEMENT',
      entityType: 'INDIVIDUAL',
      name: 'EXAMPLE PERSON',
      pan: 'ABCDE1234P',
      assessmentYear: '2024-25',
      acknowledgementNumber: '123456789012345',
      dateOfFiling: '2024-12-31',
      filedUnderSection: 'Filed u/s 139(4) - Belated Return',
      totalIncome: 100000,
      totalTaxInterestAndFeePayable: 5000,
      taxesPaid: 5000,
      evidence: []
    });

    expect(parsed.filingSection).toBe('139(4)');
    expect(parsed.filingType).toBe('BELATED');
  });
});
