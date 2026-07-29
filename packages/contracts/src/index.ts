import { z } from 'zod';

export const filingTypeSchema = z.enum(['ORIGINAL', 'BELATED', 'REVISED', 'UPDATED', 'UNKNOWN']);
export const entityTypeSchema = z.enum(['INDIVIDUAL', 'COMPANY']);
export const documentTypeSchema = z.enum([
  'ITR_ACKNOWLEDGEMENT',
  'ITR_FULL',
  'GSTR_1',
  'GSTR_1A',
  'GSTR_3B',
  'AUDITED_FINANCIAL_STATEMENTS',
  'TDS_STATEMENT',
  'COMPANY_MASTER_DATA',
  'UNKNOWN'
]);
export const relationshipStatusSchema = z.enum(['DOCUMENT_VERIFIED', 'USER_CONFIRMED', 'UNVERIFIED']);
export const sourceUnitSchema = z.enum(['RUPEES', 'HUNDREDS', 'LAKHS']);
export const financialSectionSchema = z.enum(['LIABILITIES', 'ASSETS', 'PROFIT_AND_LOSS']);
export const comparisonStatusSchema = z.enum(['MATCH', 'ROUNDING_ACCEPTED', 'MISMATCH', 'MISSING_SOURCE']);

const scoreSchema = z.number().min(0).max(1);
const evidenceSchema = z.record(z.string(), z.string()).default({});
const provenanceSchema = z.array(z.object({
  field: z.string().min(1),
  sourceLabel: z.string().min(1),
  sourcePage: z.number().int().positive().optional(),
  sourceText: z.string().min(1),
  confidence: scoreSchema
})).default([]);

export const taxVectorSchema = z.object({
  igst: z.number().finite().default(0),
  cgst: z.number().finite().default(0),
  sgst: z.number().finite().default(0),
  cess: z.number().finite().default(0)
});

export const taxCreditSummarySchema = z.object({
  tds: z.number().nonnegative().default(0),
  tcs: z.number().nonnegative().default(0),
  advanceTax: z.number().nonnegative().default(0),
  selfAssessmentTax: z.number().nonnegative().default(0),
  total: z.number().nonnegative().default(0)
});

export const taxChallanSchema = z.object({
  type: z.enum(['ADVANCE_TAX', 'SELF_ASSESSMENT_TAX', 'OTHER']),
  amount: z.number().nonnegative(),
  depositDate: z.string().optional(),
  bsrCode: z.string().optional(),
  serialNumber: z.string().optional(),
  sourcePage: z.number().int().positive().optional()
});

export const statementValueSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  section: financialSectionSchema,
  sourceAmount: z.number().finite(),
  sourceUnit: sourceUnitSchema.default('RUPEES'),
  sourcePage: z.number().int().positive().optional(),
  evidence: z.string().optional()
});

export const relationshipSchema = z.object({
  role: z.enum(['DIRECTOR', 'PARTNER', 'PROPRIETOR', 'AUTHORIZED_SIGNATORY', 'OTHER']),
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  din: z.string().regex(/^\d{8}$/).optional(),
  status: relationshipStatusSchema.default('DOCUMENT_VERIFIED')
});

export const auditRecordSchema = z.object({
  type: z.enum(['STATUTORY_FINANCIAL_STATEMENT_AUDIT', 'TAX_AUDIT_REPORT']),
  auditorName: z.string().optional(),
  firmName: z.string().optional(),
  membershipNumber: z.string().optional(),
  firmRegistrationNumber: z.string().optional(),
  reportDate: z.string().optional(),
  filingDate: z.string().optional(),
  acknowledgementNumber: z.string().optional(),
  udin: z.string().optional()
});

const itrConfidenceSchema = z.object({
  name: scoreSchema,
  pan: scoreSchema,
  assessmentYear: scoreSchema,
  acknowledgementNumber: scoreSchema,
  filingDate: scoreSchema,
  filingType: scoreSchema,
  totalIncome: scoreSchema,
  totalTaxInterestFeePayable: scoreSchema,
  totalTaxesPaid: scoreSchema
}).passthrough();

const itrBaseShape = {
  entityType: entityTypeSchema,
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  cin: z.string().optional(),
  din: z.string().regex(/^\d{8}$/).optional(),
  formType: z.string().optional(),
  assessmentYear: z.string().regex(/^20\d{2}-\d{2}$/),
  acknowledgementNumber: z.string().regex(/^\d{10,20}$/),
  filingDate: z.string().min(8),
  filingSection: z.string().optional(),
  filingType: filingTypeSchema,
  totalIncome: z.number().nonnegative(),
  currentYearBusinessLoss: z.number().nonnegative().optional(),
  totalTaxInterestFeePayable: z.number().nonnegative(),
  totalTaxesPaid: z.number().nonnegative(),
  refundOrDemand: z.number().finite().optional(),
  originalAcknowledgementNumber: z.string().regex(/^\d{10,20}$/).optional(),
  originalFilingDate: z.string().min(8).optional(),
  taxCredits: taxCreditSummarySchema.default({
    tds: 0,
    tcs: 0,
    advanceTax: 0,
    selfAssessmentTax: 0,
    total: 0
  }),
  relationships: z.array(relationshipSchema).default([]),
  auditRecords: z.array(auditRecordSchema).default([]),
  statementValues: z.array(statementValueSchema).default([]),
  confidence: itrConfidenceSchema,
  evidence: evidenceSchema,
  provenance: provenanceSchema
};

export const itrExtractionSchema = z.object({
  documentType: z.literal('ITR_ACKNOWLEDGEMENT'),
  ...itrBaseShape
});

export const fullItrExtractionSchema = z.object({
  documentType: z.literal('ITR_FULL'),
  ...itrBaseShape
});

const gstBaseShape = {
  entityType: z.literal('COMPANY'),
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/),
  stateCode: z.string().regex(/^\d{2}$/),
  stateName: z.string().min(2),
  financialYear: z.string().regex(/^20\d{2}-\d{2}$/),
  taxPeriod: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  arn: z.string().min(8),
  arnDate: z.string().min(8),
  taxableOutwardValue: z.number().finite(),
  zeroRatedOutwardValue: z.number().finite().default(0),
  exemptNilOutwardValue: z.number().finite().default(0),
  nonGstOutwardValue: z.number().finite().default(0),
  reverseChargeOutwardValue: z.number().finite().default(0),
  totalOutwardValue: z.number().finite(),
  outputTax: taxVectorSchema,
  grossItc: taxVectorSchema.default({ igst: 0, cgst: 0, sgst: 0, cess: 0 }),
  reversedItc: taxVectorSchema.default({ igst: 0, cgst: 0, sgst: 0, cess: 0 }),
  netItc: taxVectorSchema.default({ igst: 0, cgst: 0, sgst: 0, cess: 0 }),
  interest: taxVectorSchema.default({ igst: 0, cgst: 0, sgst: 0, cess: 0 }),
  lateFee: taxVectorSchema.default({ igst: 0, cgst: 0, sgst: 0, cess: 0 }),
  amendmentDifferentialValue: z.number().finite().default(0),
  creditDebitNoteValue: z.number().finite().default(0),
  authorizedSignatory: z.string().optional(),
  signatoryDesignation: z.string().optional(),
  confidence: z.record(z.string(), scoreSchema).default({}),
  evidence: evidenceSchema,
  provenance: provenanceSchema
};

export const gstr1ExtractionSchema = z.object({ documentType: z.literal('GSTR_1'), ...gstBaseShape });
export const gstr1AExtractionSchema = z.object({ documentType: z.literal('GSTR_1A'), ...gstBaseShape });
export const gstr3BExtractionSchema = z.object({ documentType: z.literal('GSTR_3B'), ...gstBaseShape });

export const auditedFinancialStatementsExtractionSchema = z.object({
  documentType: z.literal('AUDITED_FINANCIAL_STATEMENTS'),
  entityType: z.literal('COMPANY'),
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  cin: z.string().optional(),
  financialYear: z.string().regex(/^20\d{2}-\d{2}$/),
  asOfDate: z.string().min(8),
  detectedUnit: sourceUnitSchema,
  statementValues: z.array(statementValueSchema).min(1),
  auditRecords: z.array(auditRecordSchema).default([]),
  confidence: z.record(z.string(), scoreSchema).default({}),
  evidence: evidenceSchema,
  provenance: provenanceSchema
});

export const tdsStatementExtractionSchema = z.object({
  documentType: z.literal('TDS_STATEMENT'),
  entityType: entityTypeSchema,
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  cin: z.string().optional(),
  assessmentYear: z.string().regex(/^20\d{2}-\d{2}$/),
  financialYear: z.string().regex(/^20\d{2}-\d{2}$/).optional(),
  taxCredits: taxCreditSummarySchema,
  challans: z.array(taxChallanSchema).default([]),
  confidence: z.record(z.string(), scoreSchema).default({}),
  evidence: evidenceSchema,
  provenance: provenanceSchema
});

export const documentExtractionSchema = z.discriminatedUnion('documentType', [
  itrExtractionSchema,
  fullItrExtractionSchema,
  gstr1ExtractionSchema,
  gstr1AExtractionSchema,
  gstr3BExtractionSchema,
  auditedFinancialStatementsExtractionSchema,
  tdsStatementExtractionSchema
]);

export const reportRowSchema = z.object({
  acknowledgementNumber: z.string(),
  filingDate: z.string(),
  filingSection: z.string().optional(),
  filingType: filingTypeSchema,
  assessmentYear: z.string(),
  totalIncome: z.number().nonnegative(),
  currentYearBusinessLoss: z.number().nonnegative().optional(),
  totalTaxInterestFeePayable: z.number().nonnegative(),
  totalTaxesPaid: z.number().nonnegative(),
  refundOrDemand: z.number().finite().optional(),
  originalAcknowledgementNumber: z.string().optional(),
  originalFilingDate: z.string().optional()
});

export const reportTemplateConfigSchema = z.object({
  bankName: z.string().min(1).default('____________________ Bank'),
  branchName: z.string().min(1).default('____________________ Branch'),
  address: z.string().min(1).default('____________________'),
  udin: z.string().min(1).default('____________________'),
  reference: z.string().min(1).default('SBA/2026-27/________/_____'),
  firmName: z.string().min(1).default('Singhi Bikash & Associates'),
  firmDescription: z.string().min(1).default('Chartered Accountants'),
  firmRegistration: z.string().min(1).default('Firm Regd. No. 020937N'),
  signerName: z.string().min(1).default('CA BIKASH SINGHI (B. Com, FCA, IP)'),
  signerDesignation: z.string().min(1).default('Partner'),
  membershipNumber: z.string().min(1).default('M. No: 098836')
});

export const reportTemplateUpdateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(''),
  isActive: z.boolean().default(true),
  config: reportTemplateConfigSchema
});

export const individualReportSchema = z.object({
  clientName: z.string(),
  pan: z.string(),
  reportDate: z.string(),
  rows: z.array(reportRowSchema).min(1),
  ...reportTemplateConfigSchema.shape
});

export const itrReportSectionSchema = z.object({
  sectionLabel: z.string().min(1),
  clientName: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  entityType: entityTypeSchema,
  din: z.string().regex(/^\d{8}$/).optional(),
  relationshipStatus: relationshipStatusSchema.default('UNVERIFIED'),
  rows: z.array(reportRowSchema).min(1)
});

export const multiIndividualReportSchema = z.object({
  reportDate: z.string().min(8),
  subjectEntities: z.array(z.object({
    name: z.string().min(2),
    pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/)
  })).min(2),
  itrSections: z.array(itrReportSectionSchema.extend({
    entityType: z.literal('INDIVIDUAL')
  })).min(2),
  ...reportTemplateConfigSchema.shape
});

export const gstReconciliationRowSchema = z.object({
  period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/),
  gstr1TotalOutwardValue: z.number().finite(),
  gstr3bTotalOutwardValue: z.number().finite(),
  gstr1OutputTax: taxVectorSchema.optional(),
  gstr3bOutputTax: taxVectorSchema.optional(),
  sourceDocumentIds: z.array(z.string()).default([])
});

export const gstRegistrationReportSchema = z.object({
  gstin: z.string().regex(/^\d{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/),
  stateCode: z.string().regex(/^\d{2}$/),
  stateName: z.string().min(2),
  financialYear: z.string().regex(/^20\d{2}-\d{2}$/),
  rows: z.array(gstReconciliationRowSchema).min(1)
});

export const financialComparisonRowSchema = z.object({
  key: z.string().min(1),
  particulars: z.string().min(1),
  section: financialSectionSchema,
  statementValueRupees: z.number().finite().nullable(),
  itrValueRupees: z.number().finite().nullable(),
  mappingTarget: z.string().optional(),
  sourceRemark: z.string().optional()
});

export const balanceSheetReportSchema = z.object({
  asOfDate: z.string().min(8),
  assessmentYear: z.string().regex(/^20\d{2}-\d{2}$/),
  displayUnit: sourceUnitSchema,
  toleranceRupees: z.number().nonnegative().default(1),
  rows: z.array(financialComparisonRowSchema).min(1)
});

export const structuredRemarkSchema = z.object({
  entityPan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
  gstin: z.string().optional(),
  assessmentYear: z.string().optional(),
  financialYear: z.string().optional(),
  type: z.string().min(1),
  section: z.string().optional(),
  amount: z.number().finite().optional(),
  severity: z.enum(['INFO', 'WARNING', 'REVIEW_REQUIRED']),
  text: z.string().min(1)
});

export const consolidatedReportSchema = z.object({
  companyName: z.string().min(2),
  companyPan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  cin: z.string().optional(),
  reportDate: z.string().min(8),
  subjectEntities: z.array(z.object({ name: z.string().min(2), pan: z.string().optional() })).min(1),
  itrSections: z.array(itrReportSectionSchema).min(1),
  gstSections: z.array(gstRegistrationReportSchema).default([]),
  balanceSheet: balanceSheetReportSchema.optional(),
  remarks: z.array(structuredRemarkSchema).default([]),
  ...reportTemplateConfigSchema.shape
});

export type ItrExtraction = z.infer<typeof itrExtractionSchema>;
export type FullItrExtraction = z.infer<typeof fullItrExtractionSchema>;
export type GstReturnExtraction = z.infer<typeof gstr1ExtractionSchema | typeof gstr1AExtractionSchema | typeof gstr3BExtractionSchema>;
export type AuditedFinancialStatementsExtraction = z.infer<typeof auditedFinancialStatementsExtractionSchema>;
export type TdsStatementExtraction = z.infer<typeof tdsStatementExtractionSchema>;
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;
export type ReportRow = z.infer<typeof reportRowSchema>;
export type IndividualReport = z.infer<typeof individualReportSchema>;
export type MultiIndividualReport = z.infer<typeof multiIndividualReportSchema>;
export type ConsolidatedReport = z.infer<typeof consolidatedReportSchema>;
export type ReportTemplateConfig = z.infer<typeof reportTemplateConfigSchema>;
export type ReportTemplateUpdate = z.infer<typeof reportTemplateUpdateSchema>;
export type TaxVector = z.infer<typeof taxVectorSchema>;
export type TaxCreditSummary = z.infer<typeof taxCreditSummarySchema>;
export type StatementValue = z.infer<typeof statementValueSchema>;
