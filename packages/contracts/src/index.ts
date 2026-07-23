import { z } from 'zod';

export const filingTypeSchema = z.enum(['ORIGINAL', 'REVISED', 'UPDATED', 'UNKNOWN']);
export const entityTypeSchema = z.enum(['INDIVIDUAL', 'COMPANY']);

export const itrExtractionSchema = z.object({
  documentType: z.literal('ITR_ACKNOWLEDGEMENT'),
  entityType: entityTypeSchema,
  name: z.string().min(2),
  pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  assessmentYear: z.string().regex(/^20\d{2}-\d{2}$/),
  acknowledgementNumber: z.string().regex(/^\d{10,20}$/),
  filingDate: z.string().min(8),
  filingType: filingTypeSchema,
  totalIncome: z.number().nonnegative(),
  totalTaxInterestFeePayable: z.number().nonnegative(),
  totalTaxesPaid: z.number().nonnegative(),
  confidence: z.object({
    name: z.number().min(0).max(1),
    pan: z.number().min(0).max(1),
    assessmentYear: z.number().min(0).max(1),
    acknowledgementNumber: z.number().min(0).max(1),
    filingDate: z.number().min(0).max(1),
    filingType: z.number().min(0).max(1),
    totalIncome: z.number().min(0).max(1),
    totalTaxInterestFeePayable: z.number().min(0).max(1),
    totalTaxesPaid: z.number().min(0).max(1)
  }),
  evidence: z.record(z.string(), z.string()).default({})
});

export const reportRowSchema = z.object({
  acknowledgementNumber: z.string(),
  filingDate: z.string(),
  filingType: filingTypeSchema,
  assessmentYear: z.string(),
  totalIncome: z.number().nonnegative(),
  totalTaxInterestFeePayable: z.number().nonnegative(),
  totalTaxesPaid: z.number().nonnegative()
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

export type ItrExtraction = z.infer<typeof itrExtractionSchema>;
export type IndividualReport = z.infer<typeof individualReportSchema>;
export type ReportTemplateConfig = z.infer<typeof reportTemplateConfigSchema>;
export type ReportTemplateUpdate = z.infer<typeof reportTemplateUpdateSchema>;
