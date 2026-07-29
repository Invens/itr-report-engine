import { describe, expect, it } from 'vitest';
import { tdsStatementExtractionSchema } from '@itr/contracts';
import './tds-schema-normalization.js';
import './tds-nested-schema-normalization.js';

describe('nested Form 26AS model normalization', () => {
  it('maps taxpayer and aggregateTaxCredits objects into the strict schema', () => {
    const parsed = tdsStatementExtractionSchema.parse({
      documentType: 'TDS_STATEMENT',
      taxpayer: {
        pan: 'ALQPJ4174K',
        name: 'SANKALP JAIN',
        address: 'F 20, SECTOR 40, NOIDA, UTTAR PRADESH, 201301',
        assessmentYear: '2024-25'
      },
      aggregateTaxCredits: {
        tds: 513697,
        tcs: 0,
        advanceTax: 0,
        selfAssessmentTax: 0
      },
      advanceTaxChallans: [],
      selfAssessmentTaxChallans: [],
      evidenceSnippets: {
        taxpayerName: 'SANKALP JAIN',
        pan: 'ALQPJ4174K',
        assessmentYear: '2024-25'
      }
    });

    expect(parsed.entityType).toBe('INDIVIDUAL');
    expect(parsed.name).toBe('SANKALP JAIN');
    expect(parsed.pan).toBe('ALQPJ4174K');
    expect(parsed.assessmentYear).toBe('2024-25');
    expect(parsed.taxCredits).toEqual({
      tds: 513697,
      tcs: 0,
      advanceTax: 0,
      selfAssessmentTax: 0,
      total: 513697
    });
    expect(parsed.challans).toEqual([]);
    expect(parsed.evidence.name).toBe('SANKALP JAIN');
    expect(parsed.evidence.pan).toBe('ALQPJ4174K');
  });

  it('normalizes aliased advance-tax and self-assessment-tax challans', () => {
    const parsed = tdsStatementExtractionSchema.parse({
      documentType: 'TDS_STATEMENT',
      taxpayer: {
        pan: 'AABCE1234C',
        name: 'EXAMPLE PRIVATE LIMITED',
        assessmentYear: '2025-26'
      },
      aggregateTaxCredits: {
        tds: 100,
        tcs: 20,
        advanceTax: 30,
        selfAssessmentTax: 40
      },
      advanceTaxChallans: [{
        challanAmount: 30,
        dateOfDeposit: '2024-12-15',
        BSRCode: '1234567',
        challanSerialNumber: '00001'
      }],
      selfAssessmentTaxChallans: [{
        taxPaid: 40,
        challanDate: '2025-07-01'
      }]
    });

    expect(parsed.entityType).toBe('COMPANY');
    expect(parsed.taxCredits.total).toBe(190);
    expect(parsed.challans).toEqual([
      {
        type: 'ADVANCE_TAX',
        amount: 30,
        depositDate: '2024-12-15',
        bsrCode: '1234567',
        serialNumber: '00001'
      },
      {
        type: 'SELF_ASSESSMENT_TAX',
        amount: 40,
        depositDate: '2025-07-01'
      }
    ]);
  });
});
