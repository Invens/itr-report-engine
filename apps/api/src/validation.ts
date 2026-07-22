import type { ItrExtraction } from '@itr/contracts';

export type ValidationIssue = { field: string; severity: 'ERROR' | 'WARNING'; message: string };

export function validateExtraction(value: ItrExtraction): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const confidenceThreshold = 0.85;

  for (const [field, score] of Object.entries(value.confidence)) {
    if (score < confidenceThreshold) {
      issues.push({ field, severity: 'WARNING', message: `Low extraction confidence (${score.toFixed(2)})` });
    }
  }

  if (!value.evidence.pan?.toUpperCase().includes(value.pan)) {
    issues.push({ field: 'pan', severity: 'WARNING', message: 'PAN is not present in the supplied evidence snippet' });
  }

  if (value.totalTaxesPaid < 0 || value.totalIncome < 0 || value.totalTaxInterestFeePayable < 0) {
    issues.push({ field: 'financials', severity: 'ERROR', message: 'Financial values cannot be negative' });
  }

  if (value.filingType === 'UNKNOWN') {
    issues.push({ field: 'filingType', severity: 'WARNING', message: 'Filing type requires manual review' });
  }

  return issues;
}

export function groupKey(value: ItrExtraction) {
  return `${value.pan}:${value.name.trim().toUpperCase()}`;
}
