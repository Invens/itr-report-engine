import {
  DocumentStatus,
  EntityType,
  FilingType,
  Prisma,
  ReportStatus
} from '@prisma/client';
import {
  reportTemplateConfigSchema,
  type IndividualReport,
  type ItrExtraction,
  type ReportTemplateUpdate
} from '@itr/contracts';
import type { ValidationIssue } from './validation.js';
import { prisma } from './database.js';

const DEFAULT_TEMPLATE_KEY = 'individual-itr';
const DEFAULT_TEMPLATE_NAME = 'Individual ITR Verification';
const DEFAULT_TEMPLATE_DESCRIPTION = 'Verification report for one individual with one or more assessment years.';

function toDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function findOrCreateClient(extraction: Pick<ItrExtraction, 'name' | 'pan' | 'entityType'>) {
  const existing = await prisma.clientEntity.findFirst({ where: { pan: extraction.pan } });

  if (existing) {
    if (existing.name !== extraction.name || existing.entityType !== extraction.entityType) {
      return prisma.clientEntity.update({
        where: { id: existing.id },
        data: {
          name: extraction.name,
          entityType: extraction.entityType as EntityType
        }
      });
    }

    return existing;
  }

  return prisma.clientEntity.create({
    data: {
      name: extraction.name,
      pan: extraction.pan,
      entityType: extraction.entityType as EntityType
    }
  });
}

export async function ensureDefaultTemplate() {
  const config = reportTemplateConfigSchema.parse({});

  return prisma.reportTemplate.upsert({
    where: { key: DEFAULT_TEMPLATE_KEY },
    update: {},
    create: {
      key: DEFAULT_TEMPLATE_KEY,
      name: DEFAULT_TEMPLATE_NAME,
      reportType: 'INDIVIDUAL_ITR',
      description: DEFAULT_TEMPLATE_DESCRIPTION,
      isActive: true,
      config: config as Prisma.InputJsonValue
    }
  });
}

export async function getDefaultTemplateConfig() {
  const template = await ensureDefaultTemplate();
  return reportTemplateConfigSchema.parse(template.config);
}

export async function listTemplates() {
  await ensureDefaultTemplate();
  const templates = await prisma.reportTemplate.findMany({ orderBy: { name: 'asc' } });

  return templates.map((template) => ({
    ...template,
    config: reportTemplateConfigSchema.parse(template.config)
  }));
}

export async function updateTemplate(key: string, input: ReportTemplateUpdate) {
  await ensureDefaultTemplate();

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
      after: {
        key: template.key,
        name: template.name,
        isActive: template.isActive
      }
    }
  });

  return {
    ...template,
    config: reportTemplateConfigSchema.parse(template.config)
  };
}

export async function persistExtraction(input: {
  originalName: string;
  mimeType: string;
  storageKey: string;
  sha256: string;
  extraction: ItrExtraction;
  issues: ValidationIssue[];
  ipAddress?: string;
}) {
  const client = await findOrCreateClient(input.extraction);
  const status = input.issues.length > 0 ? DocumentStatus.NEEDS_REVIEW : DocumentStatus.VERIFIED;

  const document = await prisma.document.upsert({
    where: { sha256: input.sha256 },
    create: {
      originalName: input.originalName,
      mimeType: input.mimeType,
      storageKey: input.storageKey,
      sha256: input.sha256,
      status,
      documentType: input.extraction.documentType,
      assessmentYear: input.extraction.assessmentYear,
      acknowledgement: input.extraction.acknowledgementNumber,
      filingDate: toDate(input.extraction.filingDate),
      filingType: input.extraction.filingType as FilingType,
      totalIncome: input.extraction.totalIncome,
      taxPayable: input.extraction.totalTaxInterestFeePayable,
      taxesPaid: input.extraction.totalTaxesPaid,
      extractedJson: input.extraction as unknown as Prisma.InputJsonValue,
      confidenceJson: input.extraction.confidence as Prisma.InputJsonValue,
      validationJson: input.issues as unknown as Prisma.InputJsonValue,
      clientEntityId: client.id
    },
    update: {
      originalName: input.originalName,
      status,
      assessmentYear: input.extraction.assessmentYear,
      acknowledgement: input.extraction.acknowledgementNumber,
      filingDate: toDate(input.extraction.filingDate),
      filingType: input.extraction.filingType as FilingType,
      totalIncome: input.extraction.totalIncome,
      taxPayable: input.extraction.totalTaxInterestFeePayable,
      taxesPaid: input.extraction.totalTaxesPaid,
      extractedJson: input.extraction as unknown as Prisma.InputJsonValue,
      confidenceJson: input.extraction.confidence as Prisma.InputJsonValue,
      validationJson: input.issues as unknown as Prisma.InputJsonValue,
      errorMessage: null,
      clientEntityId: client.id
    }
  });

  await prisma.auditLog.create({
    data: {
      action: 'DOCUMENT_EXTRACTED',
      entityType: 'Document',
      entityId: document.id,
      ipAddress: input.ipAddress,
      after: {
        originalName: input.originalName,
        clientName: input.extraction.name,
        pan: input.extraction.pan,
        assessmentYear: input.extraction.assessmentYear,
        issueCount: input.issues.length,
        status
      }
    }
  });

  return document;
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

  const report = await prisma.report.create({
    data: {
      clientEntityId: client.id,
      reportType: 'INDIVIDUAL_ITR',
      status: ReportStatus.GENERATED,
      payload: input.report as unknown as Prisma.InputJsonValue,
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
        clientName: input.report.clientName,
        pan: input.report.pan,
        reportType: report.reportType,
        assessmentYears: input.report.rows.map((row) => row.assessmentYear),
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
    client: {
      name: report.clientEntity.name,
      pan: report.clientEntity.pan
    }
  }));
}

export async function listAuditLogs() {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 300
  });
}
