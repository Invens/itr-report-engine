import type { DocumentExtraction, ItrExtraction, TaxCreditSummary } from '@itr/contracts';
import {
  derivePanFromGstin,
  expectedGstr1OutwardValue,
  expectedGstr3bOutwardValue,
  normalizeLegalName
} from './report-rules.js';

export type ValidationIssue = {
  field: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  code?: string;
};

function confidenceIssues(confidence: Record<string, number>) {
  const issues: ValidationIssue[] = [];
  const confidenceThreshold = 0.85;

  for (const [field, score] of Object.entries(confidence)) {
    if (score < confidenceThreshold) {
      issues.push({
        field,
        severity: 'WARNING',
        code: 'LOW_CONFIDENCE',
        message: `Low extraction confidence (${score.toFixed(2)})`
      });
    }
  }
  return issues;
}

function validateTaxCredits(value: TaxCreditSummary): ValidationIssue[] {
  const expected = value.tds + value.tcs + value.advanceTax + value.selfAssessmentTax;
  if (Math.abs(value.total - expected) <= 1) return [];
  return [{
    field: 'taxCredits.total',
    severity: 'WARNING',
    code: 'TAX_CREDIT_TOTAL_MISMATCH',
    message: `Tax-credit total differs from TDS, TCS, advance tax and self-assessment tax components by ${(value.total - expected).toFixed(2)}`
  }];
}

export function validateExtraction(value: ItrExtraction): ValidationIssue[] {
  const issues = [
    ...confidenceIssues(value.confidence as Record<string, number>),
    ...validateTaxCredits(value.taxCredits)
  ];

  if (!value.evidence.pan?.toUpperCase().includes(value.pan)) {
    issues.push({
      field: 'pan',
      severity: 'WARNING',
      code: 'PAN_EVIDENCE_MISSING',
      message: 'PAN is not present in the supplied evidence snippet'
    });
  }

  if (value.filingType === 'UNKNOWN') {
    issues.push({
      field: 'filingType',
      severity: 'WARNING',
      code: 'FILING_TYPE_REVIEW',
      message: 'Filing type requires manual review'
    });
  }

  if (value.filingSection === '139(4)' && value.filingType !== 'BELATED') {
    issues.push({
      field: 'filingType',
      severity: 'ERROR',
      code: 'BELATED_MAPPING_ERROR',
      message: 'A return filed under section 139(4) must be classified as BELATED'
    });
  }

  if (value.currentYearBusinessLoss && value.totalIncome === value.currentYearBusinessLoss) {
    issues.push({
      field: 'totalIncome',
      severity: 'WARNING',
      code: 'LOSS_INCOME_COLLISION',
      message: 'Total income equals current-year business loss; verify that the two labelled fields were not substituted'
    });
  }

  return issues;
}

export function validateDocumentExtraction(value: DocumentExtraction): ValidationIssue[] {
  if (value.documentType === 'ITR_ACKNOWLEDGEMENT') return validateExtraction(value);

  const issues = confidenceIssues(value.confidence as Record<string, number>);

  if (value.documentType === 'ITR_FULL') {
    issues.push(...validateTaxCredits(value.taxCredits));
    if (value.filingSection === '139(4)' && value.filingType !== 'BELATED') {
      issues.push({
        field: 'filingType',
        severity: 'ERROR',
        code: 'BELATED_MAPPING_ERROR',
        message: 'A return filed under section 139(4) must be classified as BELATED'
      });
    }

    const duplicateRelationships = new Set<string>();
    for (const relation of value.relationships) {
      const key = `${relation.pan ?? relation.din ?? ''}:${normalizeLegalName(relation.name)}`;
      if (duplicateRelationships.has(key)) {
        issues.push({
          field: 'relationships',
          severity: 'WARNING',
          code: 'DUPLICATE_RELATIONSHIP',
          message: `Duplicate key-person relationship detected for ${relation.name}`
        });
      }
      duplicateRelationships.add(key);
    }
    return issues;
  }

  if (value.documentType === 'AUDITED_FINANCIAL_STATEMENTS') {
    if (value.statementValues.length === 0) {
      issues.push({
        field: 'statementValues',
        severity: 'ERROR',
        code: 'NO_FINANCIAL_VALUES',
        message: 'No Balance Sheet or Profit and Loss values were extracted'
      });
    }
    return issues;
  }

  if (value.documentType === 'TDS_STATEMENT') {
    issues.push(...validateTaxCredits(value.taxCredits));
    if (!value.evidence.pan?.toUpperCase().includes(value.pan)) {
      issues.push({
        field: 'pan',
        severity: 'WARNING',
        code: 'PAN_EVIDENCE_MISSING',
        message: 'PAN is not present in the tax-statement evidence snippet'
      });
    }
    return issues;
  }

  if (derivePanFromGstin(value.gstin) !== value.pan) {
    issues.push({
      field: 'gstin',
      severity: 'ERROR',
      code: 'GSTIN_PAN_MISMATCH',
      message: 'The PAN embedded in GSTIN does not match the extracted company PAN'
    });
  }

  const expected = value.documentType === 'GSTR_3B'
    ? expectedGstr3bOutwardValue(value)
    : expectedGstr1OutwardValue(value);
  const difference = value.totalOutwardValue - expected;
  if (Math.abs(difference) > 0.01) {
    issues.push({
      field: 'totalOutwardValue',
      severity: 'WARNING',
      code: 'GST_COMPONENT_RECONCILIATION',
      message: `Final outward value differs from extracted components by ${difference.toFixed(2)}`
    });
  }

  if (value.documentType === 'GSTR_3B') {
    for (const tax of ['igst', 'cgst', 'sgst', 'cess'] as const) {
      const expectedNet = value.grossItc[tax] - value.reversedItc[tax];
      if (Math.abs(value.netItc[tax] - expectedNet) > 0.01) {
        issues.push({
          field: `netItc.${tax}`,
          severity: 'WARNING',
          code: 'ITC_RECONCILIATION',
          message: `Net ${tax.toUpperCase()} ITC does not equal available ITC less reversals`
        });
      }
    }
  }

  return issues;
}

export function groupKey(value: Pick<ItrExtraction, 'pan' | 'name'>) {
  return `${value.pan}:${normalizeLegalName(value.name)}`;
}
