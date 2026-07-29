import { tdsStatementExtractionSchema } from '@itr/contracts';

type JsonRecord = Record<string, unknown>;

const NORMALIZER_MARKER = Symbol.for('itr-report-engine.tds-nested-schema-normalizer');
const schemaObject = tdsStatementExtractionSchema as unknown as Record<PropertyKey, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim().replace(/[₹,$\s]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deriveEntityType(pan: string | undefined) {
  if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return undefined;
  if (pan[3] === 'P') return 'INDIVIDUAL';
  if (pan[3] === 'C') return 'COMPANY';
  return undefined;
}

function normalizeChallanList(value: unknown, type: 'ADVANCE_TAX' | 'SELF_ASSESSMENT_TAX') {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const source = asRecord(item);
    if (!source) return item;
    const amount = asNumber(
      source.amount ?? source.taxPaid ?? source.challanAmount ?? source.depositedAmount
    );
    const depositDate = asString(
      source.depositDate ?? source.dateOfDeposit ?? source.challanDate ?? source.date
    );
    const bsrCode = asString(source.bsrCode ?? source.BSRCode ?? source.bsr);
    const serialNumber = asString(
      source.serialNumber ?? source.challanSerialNumber ?? source.challanNo ?? source.serialNo
    );
    return {
      ...source,
      type,
      ...(amount !== undefined ? { amount } : {}),
      ...(depositDate ? { depositDate } : {}),
      ...(bsrCode ? { bsrCode } : {}),
      ...(serialNumber ? { serialNumber } : {})
    };
  });
}

function normalizeNestedTdsOutput(input: unknown): unknown {
  const value = asRecord(input);
  if (!value) return input;

  const taxpayer = asRecord(value.taxpayer);
  const aggregate = asRecord(value.aggregateTaxCredits);
  const pan = asString(value.pan ?? taxpayer?.pan)?.toUpperCase();
  const name = asString(value.name ?? value.taxpayerName ?? taxpayer?.name);
  const assessmentYear = asString(value.assessmentYear ?? taxpayer?.assessmentYear);
  const suppliedEntityType = asString(value.entityType)?.toUpperCase();
  const entityType = suppliedEntityType === 'INDIVIDUAL' || suppliedEntityType === 'COMPANY'
    ? suppliedEntityType
    : deriveEntityType(pan);

  const existingTaxCredits = asRecord(value.taxCredits);
  const tds = asNumber(existingTaxCredits?.tds ?? aggregate?.tds ?? aggregate?.TDS);
  const tcs = asNumber(existingTaxCredits?.tcs ?? aggregate?.tcs ?? aggregate?.TCS);
  const advanceTax = asNumber(
    existingTaxCredits?.advanceTax ?? aggregate?.advanceTax ?? aggregate?.advance_tax
  );
  const selfAssessmentTax = asNumber(
    existingTaxCredits?.selfAssessmentTax
      ?? aggregate?.selfAssessmentTax
      ?? aggregate?.self_assessment_tax
  );
  const allComponentsPresent = [tds, tcs, advanceTax, selfAssessmentTax]
    .every((item) => item !== undefined);
  const total = asNumber(existingTaxCredits?.total ?? aggregate?.total)
    ?? (allComponentsPresent
      ? (tds ?? 0) + (tcs ?? 0) + (advanceTax ?? 0) + (selfAssessmentTax ?? 0)
      : undefined);
  const hasTaxCredits = Boolean(existingTaxCredits) || Boolean(aggregate);
  const taxCredits = hasTaxCredits
    ? {
      ...(tds !== undefined ? { tds } : {}),
      ...(tcs !== undefined ? { tcs } : {}),
      ...(advanceTax !== undefined ? { advanceTax } : {}),
      ...(selfAssessmentTax !== undefined ? { selfAssessmentTax } : {}),
      ...(total !== undefined ? { total } : {})
    }
    : undefined;

  const evidence: Record<string, string> = {};
  for (const [key, item] of Object.entries(asRecord(value.evidence) ?? {})) {
    const text = asString(item);
    if (text) evidence[key] = text;
  }
  const snippets = asRecord(value.evidenceSnippets);
  const snippetMap: Record<string, string> = {
    taxpayerName: 'name',
    name: 'name',
    pan: 'pan',
    assessmentYear: 'assessmentYear'
  };
  for (const [key, item] of Object.entries(snippets ?? {})) {
    const text = asString(item);
    if (!text) continue;
    const target = snippetMap[key] ?? key;
    if (evidence[target] === undefined) evidence[target] = text;
  }

  const challans = Array.isArray(value.challans)
    ? value.challans
    : [
      ...normalizeChallanList(value.advanceTaxChallans, 'ADVANCE_TAX'),
      ...normalizeChallanList(value.selfAssessmentTaxChallans, 'SELF_ASSESSMENT_TAX')
    ];

  return {
    ...value,
    documentType: 'TDS_STATEMENT',
    ...(entityType ? { entityType } : {}),
    ...(name ? { name } : {}),
    ...(pan ? { pan } : {}),
    ...(assessmentYear ? { assessmentYear } : {}),
    ...(taxCredits ? { taxCredits } : {}),
    challans,
    evidence,
    confidence: asRecord(value.confidence) ?? {},
    provenance: Array.isArray(value.provenance) ? value.provenance : []
  };
}

if (!schemaObject[NORMALIZER_MARKER]) {
  const originalParse = tdsStatementExtractionSchema.parse.bind(tdsStatementExtractionSchema);
  Object.defineProperty(tdsStatementExtractionSchema, 'parse', {
    configurable: true,
    value: ((input: unknown, params?: unknown) => originalParse(
      normalizeNestedTdsOutput(input),
      params as Parameters<typeof originalParse>[1]
    )) as typeof tdsStatementExtractionSchema.parse
  });
  Object.defineProperty(schemaObject, NORMALIZER_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
}
