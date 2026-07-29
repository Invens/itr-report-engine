type JsonRecord = Record<string, unknown>;

type ItrDocumentType = 'ITR_ACKNOWLEDGEMENT' | 'ITR_FULL';
type FilingType = 'ORIGINAL' | 'BELATED' | 'REVISED' | 'UPDATED' | 'UNKNOWN';

type EvidenceItem = {
  field?: unknown;
  snippet?: unknown;
  evidence?: unknown;
  sourceText?: unknown;
  confidence?: unknown;
};

const REQUIRED_CONFIDENCE_FIELDS = [
  'name',
  'pan',
  'assessmentYear',
  'acknowledgementNumber',
  'filingDate',
  'filingType',
  'totalIncome',
  'totalTaxInterestFeePayable',
  'totalTaxesPaid'
] as const;

const EVIDENCE_FIELD_ALIASES: Record<string, string> = {
  dateOfFiling: 'filingDate',
  filedUnderSection: 'filingType',
  formNumber: 'formType',
  status: 'entityType',
  totalTaxInterestAndFeePayable: 'totalTaxInterestFeePayable',
  taxesPaid: 'totalTaxesPaid',
  taxPayableOrRefundable: 'refundOrDemand'
};

const ACKNOWLEDGEMENT_ROW_PREFIXES: Record<string, string> = {
  currentYearBusinessLoss: '1',
  totalIncome: '2',
  totalTaxInterestFeePayable: '7',
  totalTaxesPaid: '8'
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed
    .replace(/[₹,$\s]/g, '')
    .replace(/^\((.*)\)$/, '$1');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

function normalizeScore(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric !== undefined) {
    if (numeric >= 0 && numeric <= 1) return numeric;
    if (numeric > 1 && numeric <= 100) return numeric / 100;
    return undefined;
  }

  const label = asString(value)?.toUpperCase();
  if (label === 'HIGH') return 0.95;
  if (label === 'MEDIUM') return 0.75;
  if (label === 'LOW') return 0.5;
  return undefined;
}

function canonicalField(value: unknown): string | undefined {
  const field = asString(value);
  if (!field) return undefined;
  return EVIDENCE_FIELD_ALIASES[field] ?? field;
}

function normalizeEvidence(value: unknown) {
  const record: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  const suppliedRecord = asRecord(value);
  if (suppliedRecord) {
    for (const [rawField, rawSnippet] of Object.entries(suppliedRecord)) {
      const field = canonicalField(rawField);
      const snippet = asString(rawSnippet);
      if (field && snippet) record[field] = snippet;
    }
    return { record, confidence };
  }

  if (!Array.isArray(value)) return { record, confidence };
  for (const rawItem of value) {
    const item = asRecord(rawItem) as EvidenceItem | undefined;
    if (!item) continue;
    const field = canonicalField(item.field);
    const snippet = asString(item.snippet ?? item.evidence ?? item.sourceText);
    if (!field || !snippet) continue;
    if (record[field] === undefined) record[field] = snippet;
    const score = normalizeScore(item.confidence);
    if (score !== undefined && confidence[field] === undefined) confidence[field] = score;
  }
  return { record, confidence };
}

function entityType(value: JsonRecord, pan: string | undefined) {
  const supplied = asString(value.entityType ?? value.status)?.toUpperCase();
  if (supplied === 'INDIVIDUAL' || supplied === 'COMPANY') return supplied;
  if (supplied?.includes('INDIVIDUAL')) return 'INDIVIDUAL';
  if (supplied?.includes('COMPANY')) return 'COMPANY';
  if (pan?.[3] === 'P') return 'INDIVIDUAL';
  if (pan?.[3] === 'C') return 'COMPANY';
  return undefined;
}

function filingType(value: JsonRecord): FilingType {
  const supplied = asString(value.filingType ?? value.filedUnderSection)?.toUpperCase() ?? '';
  if (supplied === 'ORIGINAL' || supplied === 'BELATED' || supplied === 'REVISED'
    || supplied === 'UPDATED' || supplied === 'UNKNOWN') return supplied;
  if (supplied.includes('139(8A)') || supplied.includes('UPDATED')) return 'UPDATED';
  if (supplied.includes('139(5)') || supplied.includes('REVISED')) return 'REVISED';
  if (supplied.includes('139(4)') || supplied.includes('BELATED')) return 'BELATED';
  if (supplied.includes('139(1)') || supplied.includes('ORIGINAL')) return 'ORIGINAL';
  return 'UNKNOWN';
}

function filingSection(value: JsonRecord): string | undefined {
  const supplied = asString(value.filingSection ?? value.filedUnderSection);
  if (!supplied) return undefined;
  const match = supplied.match(/139\s*\(\s*(1|4|5|8A)\s*\)/i);
  return match ? `139(${match[1].toUpperCase()})` : undefined;
}

function trailingAmountToken(snippet: string | undefined) {
  if (!snippet) return undefined;
  const match = snippet.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/);
  return match?.[1];
}

function normalizeAcknowledgementAmounts(
  values: Record<string, number | undefined>,
  evidence: Record<string, string>
) {
  const candidates = Object.entries(ACKNOWLEDGEMENT_ROW_PREFIXES).map(([field, row]) => {
    const amount = values[field];
    const token = trailingAmountToken(evidence[field]);
    const parsedToken = asNumber(token);
    const matchesModel = amount !== undefined && parsedToken !== undefined && parsedToken === amount;
    const hasPrefix = Boolean(token?.startsWith(row) && token.length > row.length);
    return { field, row, amount, token, matchesModel, hasPrefix };
  });

  // Require a repeated cross-field pattern before stripping table row numbers.
  // This avoids modifying a legitimate amount merely because it begins with the same digit.
  const contaminated = candidates.filter((item) => item.matchesModel && item.hasPrefix).length >= 3;
  if (!contaminated) return values;

  const normalized = { ...values };
  for (const item of candidates) {
    if (!item.matchesModel || !item.hasPrefix || !item.token) continue;
    const stripped = item.token.slice(item.row.length);
    const corrected = asNumber(stripped);
    if (corrected !== undefined) normalized[item.field] = corrected;
  }
  return normalized;
}

/**
 * Maps known DeepSeek aliases into the strict ITR contracts.
 * Source amounts are not guessed. Acknowledgement row-number cleanup is applied only
 * when the same row-prefix contamination pattern is present across at least three fields.
 */
export function normalizeItrModelOutput(input: unknown, documentType: ItrDocumentType): unknown {
  const value = asRecord(input);
  if (!value) return input;

  const pan = asString(value.pan)?.toUpperCase();
  const evidenceResult = normalizeEvidence(value.evidence);
  const suppliedConfidence = asRecord(value.confidence) ?? {};
  const confidence: Record<string, number> = {};

  for (const [rawField, rawScore] of Object.entries(suppliedConfidence)) {
    const field = canonicalField(rawField);
    const score = normalizeScore(rawScore);
    if (field && score !== undefined) confidence[field] = score;
  }
  Object.assign(confidence, evidenceResult.confidence);
  for (const field of REQUIRED_CONFIDENCE_FIELDS) {
    if (confidence[field] === undefined) confidence[field] = 0.5;
  }

  const rawAmounts: Record<string, number | undefined> = {
    currentYearBusinessLoss: asNumber(value.currentYearBusinessLoss),
    totalIncome: asNumber(value.totalIncome),
    totalTaxInterestFeePayable: asNumber(
      value.totalTaxInterestFeePayable ?? value.totalTaxInterestAndFeePayable
    ),
    totalTaxesPaid: asNumber(value.totalTaxesPaid ?? value.taxesPaid)
  };
  const amounts = documentType === 'ITR_ACKNOWLEDGEMENT'
    ? normalizeAcknowledgementAmounts(rawAmounts, evidenceResult.record)
    : rawAmounts;

  const originalAcknowledgementNumber = asString(value.originalAcknowledgementNumber);
  const originalFilingDate = asString(value.originalFilingDate);
  const normalizedFilingType = filingType(value);
  const normalizedFilingSection = filingSection(value);
  const refundOrDemand = asNumber(value.refundOrDemand ?? value.taxPayableOrRefundable);

  return {
    ...value,
    documentType,
    ...(entityType(value, pan) ? { entityType: entityType(value, pan) } : {}),
    ...(pan ? { pan } : {}),
    ...(asString(value.formType ?? value.formNumber)
      ? { formType: asString(value.formType ?? value.formNumber) }
      : {}),
    ...(asString(value.filingDate ?? value.dateOfFiling)
      ? { filingDate: asString(value.filingDate ?? value.dateOfFiling) }
      : {}),
    filingType: normalizedFilingType,
    ...(normalizedFilingSection ? { filingSection: normalizedFilingSection } : {}),
    ...(amounts.currentYearBusinessLoss !== undefined
      ? { currentYearBusinessLoss: amounts.currentYearBusinessLoss }
      : {}),
    ...(amounts.totalIncome !== undefined ? { totalIncome: amounts.totalIncome } : {}),
    ...(amounts.totalTaxInterestFeePayable !== undefined
      ? { totalTaxInterestFeePayable: amounts.totalTaxInterestFeePayable }
      : {}),
    ...(amounts.totalTaxesPaid !== undefined ? { totalTaxesPaid: amounts.totalTaxesPaid } : {}),
    ...(refundOrDemand !== undefined ? { refundOrDemand } : {}),
    ...(originalAcknowledgementNumber ? { originalAcknowledgementNumber } : {}),
    ...(originalFilingDate ? { originalFilingDate } : {}),
    relationships: Array.isArray(value.relationships) ? value.relationships : [],
    auditRecords: Array.isArray(value.auditRecords) ? value.auditRecords : [],
    statementValues: Array.isArray(value.statementValues) ? value.statementValues : [],
    confidence,
    evidence: evidenceResult.record,
    provenance: Array.isArray(value.provenance) ? value.provenance : []
  };
}
