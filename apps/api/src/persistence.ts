import {
  DocumentStatus,
  EntityType,
  FilingType,
  Prisma,
  ReportStatus
} from '@itr/database';
import {
  documentExtractionSchema,
  reportTemplateConfigSchema,
  type ConsolidatedReport,
  type DocumentExtraction,
  type IndividualReport,
  type ItrExtraction,
  type ReportTemplateConfig,
  type ReportTemplateUpdate
} from '@itr/contracts';
import type { DraftSourceDocument } from './consolidated-draft.js';
import type { ValidationIssue } from './validation.js';
import { prisma } from './database.js';
import { normalizeLegalName } from './report-rules.js';

const TEMPLATE_DEFINITIONS = [
  {
    key: 'individual-itr',
    name: 'Individual ITR Verification',
    reportType: 'INDIVIDUAL_ITR',
    description: 'Verification report for one individual with one or more assessment years.'
  },
  {
    key: 'company-consolidated',
    name: 'Company Consolidated Verification',
    reportType: 'COMPANY_CONSOLIDATED_VERIFICATION',
    description: 'Company and director ITRs, state-wise GST reconciliation and Balance Sheet/ITR-6 comparison.'
  }
] as const;

type EntityIdentity = {
  name: string;
  entityType: 'INDIVIDUAL' | 'COMPANY';
  pan?: string;
  gstin?: string;
  cin?: string;
};

function toDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function chooseLegalName(existing: string, candidate: string) {
  const current = normalizeLegalName(existing);
  const next = normalizeLegalName(candidate);
  if (current === next) return existing;
  if (current.replace(/\bLTD\b/g, 'LIMITED') === next.replace(/\bLTD\b/g, 'LIMITED')) {
    return next.length > current.length ? candidate : existing;
  }
  return existing;
}

function identityFromExtraction(extraction: DocumentExtraction): EntityIdentity {
  if (extraction.documentType === 'AUDITED_FINANCIAL_STATEMENTS') {
    return {
      name: extraction.name,
      entityType: 'COMPANY',
      pan: extraction.pan,
      cin: extraction.cin
    };
  }
  if (extraction.documentType === 'GSTR_1'
    || extraction.documentType === 'GSTR_1A'
    || extraction.documentType === 'GSTR_3B') {
    return {
      name: extraction.name,
      entityType: 'COMPANY',
      pan: extraction.pan,
      gstin: extraction.gstin
    };
  }
  return {
    name: extraction.name,
    entityType: extraction.entityType,
    pan: extraction.pan,
    cin: extraction.cin
  };
}

async function findOrCreateClient(identity: EntityIdentity) {
  const existing = identity.pan
    ? await prisma.clientEntity.findFirst({ where: { pan: identity.pan } })
    : identity.gstin
      ? await prisma.clientEntity.findFirst({ where: { gstin: identity.gstin } })
      : identity.cin
        ? await prisma.clientEntity.findFirst({ where: { cin: identity.cin } })
        : await prisma.clientEntity.findFirst({
          where: {
            name: { equals: identity.name, mode: 'insensitive' },
            entityType: identity.entityType as EntityType
          }
        });

  if (existing) {
    const name = chooseLegalName(existing.name, identity.name);
    const entityType = identity.entityType as EntityType;
    if (name !== existing.name
      || existing.entityType !== entityType
      || (!existing.pan && identity.pan)
      || (!existing.cin && identity.cin)) {
      return prisma.clientEntity.update({
        where: { id: existing.id },
        data: {
          name,
          entityType,
          pan: existing.pan ?? identity.pan,
          cin: existing.cin ?? identity.cin,
          gstin: existing.pan ? existing.gstin : existing.gstin ?? identity.gstin
        }
      });
    }
    return existing;
  }

  return prisma.clientEntity.create({
    data: {
      name: identity.name,
      pan: identity.pan,
      gstin: identity.pan ? undefined : identity.gstin,
      cin: identity.cin,
      entityType: identity.entityType as EntityType
    }
  });
}

export async function ensureDefaultTemplates() {
  const config = reportTemplateConfigSchema.parse({});
  await Promise.all(TEMPLATE_DEFINITIONS.map((definition) => prisma.reportTemplate.upsert({
    where: { key: definition.key },
    update: {},
    create: {
      ...definition,
      isActive: true,
      config: config as Prisma.InputJsonValue
    }
  })));
}

export async function ensureDefaultTemplate() {
  await ensureDefaultTemplates();
  return prisma.reportTemplate.findUniqueOrThrow({ where: { key: 'individual-itr' } });
}

export async function getTemplateConfig(
  key: 'individual-itr' | 'company-consolidated'
): Promise<ReportTemplateConfig> {
  await ensureDefaultTemplates();
  const template = await prisma.reportTemplate.findUniqueOrThrow({ where: { key } });
  return reportTemplateConfigSchema.parse(template.config);
}

export async function getDefaultTemplateConfig() {
  return getTemplateConfig('individual-itr');
}

export async function listTemplates() {
  await ensureDefaultTemplates();
  const templates = await prisma.reportTemplate.findMany({ orderBy: { name: 'asc' } });
  return templates.map((template) => ({
    ...template,
    config: reportTemplateConfigSchema.parse(template.config)
  }));
}

export async function updateTemplate(key: string, input: ReportTemplateUpdate) {
  await ensureDefaultTemplates();
  const template = await prisma.reportTemplate.update({
    where: { key },
    data: {
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      config: input.config as Prisma.InputJsonValue
    }
  });

  await prisma.auditLog.create({
    data: {
      action: 'TEMPLATE_UPDATED',
      entityType: 'ReportTemplate',
      entityId: template.id,
      after: { key: template.key, name: template.name, isActive: template.isActive }
    }
  });

  return { ...template, config: reportTemplateConfigSchema.parse(template.config) };
}

function documentMetadata(extraction: DocumentExtraction) {
  if (extraction.documentType === 'ITR_ACKNOWLEDGEMENT' || extraction.documentType === 'ITR_FULL') {
    return {
      assessmentYear: extraction.assessmentYear,
      acknowledgement: extraction.acknowledgementNumber,
      filingDate: toDate(extraction.filingDate),
      filingType: extraction.filingType as FilingType,
      totalIncome: extraction.totalIncome,
      taxPayable: extraction.totalTaxInterestFeePayable,
      taxesPaid: extraction.totalTaxesPaid
    };
  }
  if (extraction.documentType === 'GSTR_1'
    || extraction.documentType === 'GSTR_1A'
    || extraction.documentType === 'GSTR_3B') {
    return {
      assessmentYear: extraction.financialYear,
      acknowledgement: extraction.arn,
      filingDate: toDate(extraction.arnDate),
      filingType: FilingType.UNKNOWN,
      totalIncome: null,
      taxPayable: null,
      taxesPaid: null
    };
  }
  return {
    assessmentYear: extraction.financialYear,
    acknowledgement: null,
    filingDate: null,
    filingType: FilingType.UNKNOWN,
    totalIncome: null,
    taxPayable: null,
    taxesPaid: null
  };
}

type PersistBundleInput = {
  originalName: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  extractions: DocumentExtraction[];
  issuesByExtraction: ValidationIssue[][];
  extractionMode?: 'PDF_TEXT' | 'OCR';
  pageCount?: number | null;
  ipAddress?: string;
};

export async function persistDocumentExtractionBundle(input: PersistBundleInput) {
  const first = input.extractions[0];
  if (!first) throw new Error('At least one logical extraction is required');
  if (input.extractions.length !== input.issuesByExtraction.length) {
    throw new Error('Every logical extraction must have a matching validation result');
  }

  const client = await findOrCreateClient(identityFromExtraction(first));
  const allIssues = input.issuesByExtraction.flat();
  const status = allIssues.length > 0 ? DocumentStatus.NEEDS_REVIEW : DocumentStatus.VERIFIED;
  const metadata = documentMetadata(first);
  const documentType = input.extractions.length === 1
    ? first.documentType
    : 'MULTI_DOCUMENT_BUNDLE';
  const extractedPayload = input.extractions.length === 1
    ? first
    : input.extractions;
  const confidencePayload = input.extractions.length === 1
    ? first.confidence
    : input.extractions.map((extraction) => extraction.confidence);
  const validationPayload = {
    logicalDocumentCount: input.extractions.length,
    logicalDocuments: input.extractions.map((extraction, index) => ({
      documentType: extraction.documentType,
      issues: input.issuesByExtraction[index] ?? []
    })),
    extractionMode: input.extractionMode ?? 'PDF_TEXT',
    pageCount: input.pageCount ?? null
  };

  const document = await prisma.document.upsert({
    where: { sha256: input.sha256 },
    create: {
      originalName: input.originalName,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      sha256: input.sha256,
      status,
      documentType,
      ...metadata,
      extractedJson: extractedPayload as unknown as Prisma.InputJsonValue,
      confidenceJson: confidencePayload as unknown as Prisma.InputJsonValue,
      validationJson: validationPayload as unknown as Prisma.InputJsonValue,
      clientEntityId: client.id
    },
    update: {
      originalName: input.originalName,
      status,
      documentType,
      ...metadata,
      extractedJson: extractedPayload as unknown as Prisma.InputJsonValue,
      confidenceJson: confidencePayload as unknown as Prisma.InputJsonValue,
      validationJson: validationPayload as unknown as Prisma.InputJsonValue,
      errorMessage: null,
      clientEntityId: client.id
    }
  });

  const identity = identityFromExtraction(first);
  await prisma.auditLog.create({
    data: {
      action: 'DOCUMENT_EXTRACTED',
      entityType: 'Document',
      entityId: document.id,
      ipAddress: input.ipAddress,
      after: {
        originalName: input.originalName,
        documentType,
        logicalDocumentCount: input.extractions.length,
        clientName: identity.name,
        pan: identity.pan,
        issueCount: allIssues.length,
        extractionMode: input.extractionMode ?? 'PDF_TEXT',
        status
      }
    }
  });

  return document;
}

export async function persistDocumentExtraction(input: {
  originalName: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  extraction: DocumentExtraction;
  issues: ValidationIssue[];
  extractionMode?: 'PDF_TEXT' | 'OCR';
  pageCount?: number | null;
  ipAddress?: string;
}) {
  return persistDocumentExtractionBundle({
    originalName: input.originalName,
    mimeType: input.mimeType,
    storageKey: input.storageKey,
    sha256: input.sha256,
    extractions: [input.extraction],
    issuesByExtraction: [input.issues],
    extractionMode: input.extractionMode,
    pageCount: input.pageCount,
    ipAddress: input.ipAddress
  });
}

export async function persistExtraction(input: {
  originalName: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  extraction: ItrExtraction;
  issues: ValidationIssue[];
  extractionMode?: 'PDF_TEXT' | 'OCR';
  pageCount?: number | null;
  ipAddress?: string;
}) {
  return persistDocumentExtraction(input);
}

export async function loadDocumentExtractions(documentIds: string[]): Promise<DraftSourceDocument[]> {
  const uniqueDocumentIds = [...new Set(documentIds)];
  const documents = await prisma.document.findMany({
    where: { id: { in: uniqueDocumentIds } },
    select: { id: true, extractedJson: true }
  });
  const found = new Set(documents.map((document) => document.id));
  const missing = uniqueDocumentIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Document records not found: ${missing.join(', ')}`);

  return documents.flatMap((document) => {
    const payloads = Array.isArray(document.extractedJson)
      ? document.extractedJson
      : [document.extractedJson];
    return payloads.map((payload) => ({
      documentId: document.id,
      extraction: documentExtractionSchema.parse(payload)
    }));
  });
}

export async function persistGeneratedReport(input: {
  report: IndividualReport;
  outputKey: string;
  ipAddress?: string;
}) {
  const client = await findOrCreateClient({
    name: input.report.clientName,
    pan: input.report.pan,
    entityType: 'INDIVIDUAL'
  });
  return persistReport({
    clientId: client.id,
    reportType: 'INDIVIDUAL_ITR',
    payload: input.report,
    outputKey: input.outputKey,
    ipAddress: input.ipAddress,
    auditSummary: {
      clientName: input.report.clientName,
      pan: input.report.pan,
      assessmentYears: input.report.rows.map((row) => row.assessmentYear)
    }
  });
}

export async function persistGeneratedConsolidatedReport(input: {
  report: ConsolidatedReport;
  outputKey: string;
  ipAddress?: string;
}) {
  const client = await findOrCreateClient({
    name: input.report.companyName,
    pan: input.report.companyPan,
    cin: input.report.cin,
    entityType: 'COMPANY'
  });
  return persistReport({
    clientId: client.id,
    reportType: 'COMPANY_CONSOLIDATED_VERIFICATION',
    payload: input.report,
    outputKey: input.outputKey,
    ipAddress: input.ipAddress,
    auditSummary: {
      clientName: input.report.companyName,
      pan: input.report.companyPan,
      itrSections: input.report.itrSections.length,
      gstRegistrations: input.report.gstSections.length,
      hasBalanceSheet: Boolean(input.report.balanceSheet)
    }
  });
}

async function persistReport(input: {
  clientId: string;
  reportType: string;
  payload: IndividualReport | ConsolidatedReport;
  outputKey: string;
  ipAddress?: string;
  auditSummary: Record<string, unknown>;
}) {
  const report = await prisma.report.create({
    data: {
      clientEntityId: input.clientId,
      reportType: input.reportType,
      status: ReportStatus.GENERATED,
      payload: input.payload as unknown as Prisma.InputJsonValue,
      outputKey: input.outputKey,
      approvedAt: new Date(),
      generatedAt: new Date()
    }
  });

  await prisma.auditLog.create({
    data: {
      action: 'REPORT_GENERATED',
      entityType: 'Report',
      entityId: report.id,
      ipAddress: input.ipAddress,
      after: {
        ...input.auditSummary,
        reportType: report.reportType,
        outputKey: input.outputKey
      }
    }
  });
  return report;
}

export async function listReports() {
  const reports = await prisma.report.findMany({
    include: { clientEntity: true },
    orderBy: { createdAt: 'desc' },
    take: 250
  });

  return reports.map((report) => ({
    id: report.id,
    reportType: report.reportType,
    status: report.status,
    outputKey: report.outputKey,
    generatedAt: report.generatedAt,
    createdAt: report.createdAt,
    client: { name: report.clientEntity.name, pan: report.clientEntity.pan }
  }));
}

export async function listAuditLogs() {
  return prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 300 });
}
