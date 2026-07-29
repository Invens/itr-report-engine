type JsonRecord = Record<string, unknown>;

type TaxCreditKey = 'tds' | 'tcs' | 'advanceTax' | 'selfAssessmentTax';

const AGGREGATE_KEYS: Record<TaxCreditKey, string[]> = {
  tds: ['aggregateTDS', 'aggregateTds'],
  tcs: ['aggregateTCS', 'aggregateTcs'],
  advanceTax: ['aggregateAdvanceTax'],
  selfAssessmentTax: ['aggregateSelfAssessmentTax']
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
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

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = asFiniteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function aggregateRecord(value: JsonRecord, key: TaxCreditKey) {
  for (const alias of AGGREGATE_KEYS[key]) {
    const record = asRecord(value[alias]);
    if (record) return record;
  }
  return undefined;
}

function normalizeConfidence(value: unknown): number | undefined {
  const numeric = asFiniteNumber(value);
  if (numeric !== undefined) {
    if (numeric > 1 && numeric <= 100) return numeric / 100;
    if (numeric >= 0 && numeric <= 1) return numeric;
    return undefined;
  }

  const label = asNonEmptyString(value)?.toUpperCase();
  if (label === 'HIGH') return 0.95;
  if (label === 'MEDIUM') return 0.75;
  if (label === 'LOW') return 0.5;
  return undefined;
}

function entityTypeFromPan(value: unknown) {
  const pan = asNonEmptyString(value)?.toUpperCase();
  if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return undefined;
  if (pan[3] === 'P') return 'INDIVIDUAL';
  if (pan[3] === 'C') return 'COMPANY';
  return undefined;
}

function normalizedEntityType(value: JsonRecord) {
  const supplied = asNonEmptyString(value.entityType)?.toUpperCase();
  if (supplied === 'INDIVIDUAL' || supplied === 'COMPANY') return supplied;
  return entityTypeFromPan(value.pan);
}

function normalizeTaxCredits(value: JsonRecord) {
  const supplied = asRecord(value.taxCredits);
  const aggregates = {
    tds: aggregateRecord(value, 'tds'),
    tcs: aggregateRecord(value, 'tcs'),
    advanceTax: aggregateRecord(value, 'advanceTax'),
    selfAssessmentTax: aggregateRecord(value, 'selfAssessmentTax')
  };

  const hasAggregate = Object.values(aggregates).some(Boolean);
  if (!supplied && !hasAggregate) return undefined;

  const tds = firstNumber(supplied?.tds, aggregates.tds?.amount, aggregates.tds?.total);
  const tcs = firstNumber(supplied?.tcs, aggregates.tcs?.amount, aggregates.tcs?.total);
  const advanceTax = firstNumber(
    supplied?.advanceTax,
    aggregates.advanceTax?.amount,
    aggregates.advanceTax?.total
  );
  const selfAssessmentTax = firstNumber(
    supplied?.selfAssessmentTax,
    aggregates.selfAssessmentTax?.amount,
    aggregates.selfAssessmentTax?.total
  );
  const componentValues = [tds, tcs, advanceTax, selfAssessmentTax];
  const calculatedTotal = componentValues.every((item) => item !== undefined)
    ? componentValues.reduce<number>((total, item) => total + (item ?? 0), 0)
    : undefined;
  const total = firstNumber(
    supplied?.total,
    asRecord(value.aggregateTaxCredits)?.amount,
    asRecord(value.aggregateTotalTaxCredits)?.amount,
    calculatedTotal
  );

  return {
    ...supplied,
    ...(tds !== undefined ? { tds } : {}),
    ...(tcs !== undefined ? { tcs } : {}),
    ...(advanceTax !== undefined ? { advanceTax } : {}),
    ...(selfAssessmentTax !== undefined ? { selfAssessmentTax } : {}),
    ...(total !== undefined ? { total } : {})
  };
}

function normalizeEvidence(value: JsonRecord) {
  const evidence = { ...(asRecord(value.evidence) ?? {}) };
  const mappings: Array<[TaxCreditKey, string]> = [
    ['tds', 'taxCredits.tds'],
    ['tcs', 'taxCredits.tcs'],
    ['advanceTax', 'taxCredits.advanceTax'],
    ['selfAssessmentTax', 'taxCredits.selfAssessmentTax']
  ];

  for (const [key, target] of mappings) {
    const source = aggregateRecord(value, key);
    const sourceEvidence = asNonEmptyString(source?.evidence);
    if (sourceEvidence && evidence[target] === undefined) evidence[target] = sourceEvidence;
  }
  return evidence;
}

function normalizeConfidenceMap(value: JsonRecord) {
  const confidence = { ...(asRecord(value.confidence) ?? {}) };
  const mappings: Array<[TaxCreditKey, string]> = [
    ['tds', 'taxCredits.tds'],
    ['tcs', 'taxCredits.tcs'],
    ['advanceTax', 'taxCredits.advanceTax'],
    ['selfAssessmentTax', 'taxCredits.selfAssessmentTax']
  ];

  for (const [key, target] of mappings) {
    const source = aggregateRecord(value, key);
    const score = normalizeConfidence(source?.confidence);
    if (score !== undefined && confidence[target] === undefined) confidence[target] = score;
  }
  return confidence;
}

/**
 * Maps known DeepSeek aliases into the strict TDS_STATEMENT contract.
 * It never substitutes a taxpayer name/PAN or fabricates a monetary amount.
 */
export function normalizeTdsStatementModelOutput(input: unknown): unknown {
  const value = asRecord(input);
  if (!value) return input;

  const name = asNonEmptyString(value.name)
    ?? asNonEmptyString(value.taxpayerName)
    ?? asNonEmptyString(value.assesseeName);
  const entityType = normalizedEntityType(value);
  const taxCredits = normalizeTaxCredits(value);
  const challans = Array.isArray(value.challans)
    ? value.challans
    : Array.isArray(value.taxChallans)
      ? value.taxChallans
      : [];

  return {
    ...value,
    documentType: 'TDS_STATEMENT',
    ...(entityType ? { entityType } : {}),
    ...(name ? { name } : {}),
    ...(taxCredits ? { taxCredits } : {}),
    challans,
    confidence: normalizeConfidenceMap(value),
    evidence: normalizeEvidence(value),
    provenance: Array.isArray(value.provenance) ? value.provenance : []
  };
}
