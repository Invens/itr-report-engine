import type {
  GstReturnExtraction,
  ReportRow,
  TaxVector
} from '@itr/contracts';

const FILING_PRECEDENCE: Record<ReportRow['filingType'], number> = {
  UNKNOWN: 0,
  ORIGINAL: 1,
  BELATED: 2,
  REVISED: 3,
  UPDATED: 4
};

export function normalizeLegalName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function derivePanFromGstin(gstin: string) {
  return gstin.slice(2, 12).toUpperCase();
}

export function displayFilingType(value: ReportRow['filingType']) {
  switch (value) {
    case 'ORIGINAL': return 'Original';
    case 'BELATED': return 'Belated Return';
    case 'REVISED': return 'Revised Return';
    case 'UPDATED': return 'Updated Return';
    default: return 'Requires Review';
  }
}

function filingTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function selectLatestItrRows(rows: ReportRow[]) {
  const selected = new Map<string, ReportRow>();

  for (const row of rows) {
    const current = selected.get(row.assessmentYear);
    if (!current) {
      selected.set(row.assessmentYear, row);
      continue;
    }

    const rowTime = filingTime(row.filingDate);
    const currentTime = filingTime(current.filingDate);
    const shouldReplace = rowTime > currentTime
      || (rowTime === currentTime && FILING_PRECEDENCE[row.filingType] > FILING_PRECEDENCE[current.filingType]);

    if (shouldReplace) selected.set(row.assessmentYear, row);
  }

  return [...selected.values()].sort((a, b) => b.assessmentYear.localeCompare(a.assessmentYear));
}

export function sortTaxPeriods<T extends { period: string }>(rows: T[]) {
  return [...rows].sort((a, b) => a.period.localeCompare(b.period));
}

export function normalizeToRupees(amount: number, unit: 'RUPEES' | 'HUNDREDS' | 'LAKHS') {
  if (unit === 'HUNDREDS') return amount * 100;
  if (unit === 'LAKHS') return amount * 100_000;
  return amount;
}

export function convertFromRupees(amount: number, unit: 'RUPEES' | 'HUNDREDS' | 'LAKHS') {
  if (unit === 'HUNDREDS') return amount / 100;
  if (unit === 'LAKHS') return amount / 100_000;
  return amount;
}

export function compareAmounts(
  left: number | null,
  right: number | null,
  toleranceRupees = 1
): { status: 'MATCH' | 'ROUNDING_ACCEPTED' | 'MISMATCH' | 'MISSING_SOURCE'; difference: number | null } {
  if (left === null || right === null) return { status: 'MISSING_SOURCE', difference: null };
  const difference = left - right;
  if (difference === 0) return { status: 'MATCH', difference };
  if (Math.abs(difference) <= toleranceRupees) return { status: 'ROUNDING_ACCEPTED', difference };
  return { status: 'MISMATCH', difference };
}

export function addTaxVectors(...values: Array<TaxVector | undefined>) {
  return values.reduce<TaxVector>((total, value) => ({
    igst: total.igst + (value?.igst ?? 0),
    cgst: total.cgst + (value?.cgst ?? 0),
    sgst: total.sgst + (value?.sgst ?? 0),
    cess: total.cess + (value?.cess ?? 0)
  }), { igst: 0, cgst: 0, sgst: 0, cess: 0 });
}

export function expectedGstr1OutwardValue(value: GstReturnExtraction) {
  return value.taxableOutwardValue
    + value.zeroRatedOutwardValue
    + value.exemptNilOutwardValue
    + value.nonGstOutwardValue
    + value.reverseChargeOutwardValue
    + value.amendmentDifferentialValue
    + value.creditDebitNoteValue;
}

export function expectedGstr3bOutwardValue(value: GstReturnExtraction) {
  return value.taxableOutwardValue
    + value.zeroRatedOutwardValue
    + value.exemptNilOutwardValue
    + value.nonGstOutwardValue;
}

export function formatIndianAmount(value: number, fractionDigits = 0) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
}

export function financialYearFromAssessmentYear(assessmentYear: string) {
  const start = Number(assessmentYear.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
