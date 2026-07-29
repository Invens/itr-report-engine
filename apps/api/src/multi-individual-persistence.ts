import { EntityType, Prisma, ReportStatus } from '@itr/database';
import type { MultiIndividualReport } from '@itr/contracts';
import { prisma } from './database.js';

export async function persistGeneratedMultiIndividualReport(input: {
  report: MultiIndividualReport;
  outputKey: string;
  ipAddress?: string;
}) {
  const first = input.report.itrSections[0];
  if (!first) throw new Error('At least one individual ITR section is required');

  const client = await prisma.clientEntity.upsert({
    where: { id: `multi-individual:${first.pan}` },
    create: {
      id: `multi-individual:${first.pan}`,
      name: first.clientName,
      pan: first.pan,
      entityType: EntityType.INDIVIDUAL
    },
    update: {
      name: first.clientName,
      entityType: EntityType.INDIVIDUAL
    }
  });

  const report = await prisma.report.create({
    data: {
      clientEntityId: client.id,
      reportType: 'MULTI_INDIVIDUAL_ITR',
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
        reportType: report.reportType,
        outputKey: input.outputKey,
        taxpayers: input.report.itrSections.map((section) => ({
          name: section.clientName,
          pan: section.pan,
          assessmentYears: section.rows.map((row) => row.assessmentYear)
        }))
      }
    }
  });

  return report;
}
