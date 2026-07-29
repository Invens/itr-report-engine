import { describe, expect, it } from 'vitest';
import { tdsStatementExtractionSchema } from '@itr/contracts';
import './tds-schema-normalization.js';

describe('Form 26AS model normalization', () => {
  it('maps DeepSeek aggregate aliases into the strict TDS statement schema', () => {
    const parsed = tdsStatementExtractionSchema.parse({
      documentType: 'TDS_STATEMENT',
      originalName: 'ALQPJ4174K-2024.pdf',
      taxpayerName: 'SANKALP JAIN',
      pan: 'ALQPJ4174K',
      assessmentYear: '2024-25',
      aggregateTDS: {
        amount: 513697,
        evidence: 'Part I and Part IV aggregate TDS',
        confidence: 'HIGH'
      },
      aggregateTCS: { amount: 0, evidence: 'No Transactions Present', confidence: 'HIGH' },
      aggregateAdvanceTax: { amount: 0, evidence: 'No challans present', confidence: 'HIGH' },
      aggregateSelfAssessmentTax: {
        amount: 0,
        evidence: 'No self-assessment challans present',
        confidence: 'HIGH'
      }
    });

    expect(parsed.entityType).toBe('INDIVIDUAL');
    expect(parsed.name).toBe('SANKALP JAIN');
    expect(parsed.taxCredits).toEqual({
      tds: 513697,
      tcs: 0,
      advanceTax: 0,
      selfAssessmentTax: 0,
      total: 513697
    });
    expect(parsed.challans).toEqual([]);
    expect(parsed.confidence['taxCredits.tds']).toBe(0.95);
    expect(parsed.evidence['taxCredits.tds']).toContain('aggregate TDS');
  });

  it('infers a company entity only from a company-type PAN', () => {
    const parsed = tdsStatementExtractionSchema.parse({
      documentType: 'TDS_STATEMENT',
      taxpayerName: 'EXAMPLE PRIVATE LIMITED',
      pan: 'AABCE1234C',
      assessmentYear: '2025-26',
      aggregateTDS: { amount: 100 },
      aggregateTCS: { amount: 20 },
      aggregateAdvanceTax: { amount: 30 },
      aggregateSelfAssessmentTax: { amount: 40 }
    });

    expect(parsed.entityType).toBe('COMPANY');
    expect(parsed.taxCredits.total).toBe(190);
  });
});
