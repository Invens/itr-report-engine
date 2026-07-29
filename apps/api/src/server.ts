import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { DocumentExtraction, ItrExtraction } from '@itr/contracts';
import {
  consolidatedReportSchema,
  individualReportSchema,
  multiIndividualReportSchema,
  reportTemplateUpdateSchema
} from '@itr/contracts';
import { env } from './config.js';
import { extractPdfContent, persistUpload } from './document-service.js';
import { extractDocumentsWithDeepSeek, extractItrWithDeepSeek } from './deepseek.js';
import { validateDocumentExtraction, validateExtraction, type ValidationIssue } from './validation.js';
import {
  generateConsolidatedReport,
  generateIndividualReport,
  generateMultiIndividualReport
} from './report-generator.js';
import { buildConsolidatedDraft } from './consolidated-draft.js';
import { prisma } from './database.js';
import { persistGeneratedMultiIndividualReport } from './multi-individual-persistence.js';
import {
  ensureDefaultTemplates,
  getDefaultTemplateConfig,
  getTemplateConfig,
  listAuditLogs,
  listReports,
  listTemplates,
  loadDocumentExtractions,
  persistDocumentExtractionBundle,
  persistExtraction,
  persistGeneratedConsolidatedReport,
  persistGeneratedReport,
  updateTemplate
} from './persistence.js';

const draftRequestSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(250),
  reportDate: z.string().min(8).optional()
});

type ExtractionResponseItem = {
  id: string;
  documentId: string;
  file: string;
  storageKey: string;
  extraction: ItrExtraction;
  issues: ValidationIssue[];
  requiresReview: boolean;
  extractionMode: 'PDF_TEXT' | 'OCR';
  pageCount: number | null;
};

type BundleExtractionResponseItem = {
  id: string;
  documentId?: string;
  file: string;
  storageKey?: string;
  extraction?: DocumentExtraction;
  issues: ValidationIssue[];
  requiresReview: boolean;
  extractionMode?: 'PDF_TEXT' | 'OCR';
  pageCount?: number | null;
  error?: string;
};

function resolveHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return { statusCode: 500, message };
  }
  const candidate = (error as { statusCode?: unknown }).statusCode;
  const statusCode = typeof candidate === 'number' && candidate >= 400 && candidate <= 599
    ? candidate
    : 500;
  return { statusCode, message };
}

function defaultReportDate() {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date());
}

function validatePdf(filename: string, mimetype: string) {
  if (mimetype !== 'application/pdf' || extname(filename).toLowerCase() !== '.pdf') {
    throw Object.assign(
      new Error(`Unsupported file: ${filename}. Only PDF is accepted.`),
      { statusCode: 415 }
    );
  }
}

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.pan', '*.gstin', '*.din']
  },
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
  bodyLimit: env.MAX_UPLOAD_MB * env.MAX_BUNDLE_FILES * 1024 * 1024
});

await app.register(helmet, { crossOriginResourcePolicy: { policy: 'same-site' } });
await app.register(cors, { origin: env.WEB_URL, credentials: true });
await app.register(multipart, {
  limits: {
    files: env.MAX_BUNDLE_FILES,
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024
  },
  throwFileSizeLimit: true
});

await ensureDefaultTemplates();

app.get('/health', async () => ({
  status: 'ok',
  service: 'itr-api',
  timestamp: new Date().toISOString()
}));

app.get('/ready', { logLevel: 'silent' }, async (_request, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ready', service: 'itr-api' };
  } catch {
    return reply.code(503).send({ status: 'not-ready', service: 'itr-api' });
  }
});

app.post('/v1/documents/extract', async (request, reply) => {
  const parts = request.files();
  const results: ExtractionResponseItem[] = [];

  for await (const part of parts) {
    validatePdf(part.filename, part.mimetype);
    const buffer = await part.toBuffer();
    const stored = await persistUpload(buffer, part.filename);
    const content = await extractPdfContent(stored.storageKey);
    const extraction = await extractItrWithDeepSeek(content.text);
    const issues = validateExtraction(extraction);
    const document = await persistExtraction({
      originalName: part.filename,
      mimeType: part.mimetype,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      extraction,
      issues,
      extractionMode: content.extractionMode,
      pageCount: content.pageCount,
      ipAddress: request.ip
    });

    results.push({
      id: randomUUID(),
      documentId: document.id,
      file: part.filename,
      storageKey: stored.storageKey,
      extraction,
      issues,
      requiresReview: issues.length > 0,
      extractionMode: content.extractionMode,
      pageCount: content.pageCount
    });
  }

  if (results.length === 0) {
    return reply.code(400).send({ error: 'No PDF files were uploaded' });
  }
  return { results };
});

app.post('/v1/documents/extract-bundle', async (request, reply) => {
  const parts = request.files();
  const results: BundleExtractionResponseItem[] = [];
  let failedPhysicalFiles = 0;

  for await (const part of parts) {
    try {
      validatePdf(part.filename, part.mimetype);
      const buffer = await part.toBuffer();
      const stored = await persistUpload(buffer, part.filename);
      const content = await extractPdfContent(stored.storageKey);
      const extractions = await extractDocumentsWithDeepSeek(content.text, part.filename);
      const issuesByExtraction = extractions.map((extraction) => validateDocumentExtraction(extraction));
      const document = await persistDocumentExtractionBundle({
        originalName: part.filename,
        mimeType: part.mimetype,
        storageKey: stored.storageKey,
        sha256: stored.sha256,
        extractions,
        issuesByExtraction,
        extractionMode: content.extractionMode,
        pageCount: content.pageCount,
        ipAddress: request.ip
      });

      extractions.forEach((extraction, index) => {
        const issues = issuesByExtraction[index] ?? [];
        results.push({
          id: `${document.id}:${index}`,
          documentId: document.id,
          file: extractions.length > 1
            ? `${part.filename} · logical return ${index + 1}`
            : part.filename,
          storageKey: stored.storageKey,
          extraction,
          issues,
          requiresReview: issues.length > 0,
          extractionMode: content.extractionMode,
          pageCount: content.pageCount
        });
      });
    } catch (error) {
      failedPhysicalFiles += 1;
      const message = error instanceof Error ? error.message : 'Unknown extraction failure';
      request.log.warn({ file: part.filename, error: message }, 'bundle document extraction failed');
      results.push({
        id: randomUUID(),
        file: part.filename,
        issues: [{
          field: 'document',
          severity: 'ERROR',
          code: 'EXTRACTION_FAILED',
          message
        }],
        requiresReview: true,
        error: message
      });
    }
  }

  if (results.length === 0) {
    return reply.code(400).send({ error: 'No PDF files were uploaded' });
  }
  return {
    results,
    successfulDocumentIds: [...new Set(
      results.flatMap((item) => item.documentId ? [item.documentId] : [])
    )],
    failedCount: failedPhysicalFiles
  };
});

app.post('/v1/reports/consolidated/draft', async (request, reply) => {
  const parsed = draftRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(422).send({
      error: 'Invalid draft request',
      details: parsed.error.flatten()
    });
  }

  const documents = await loadDocumentExtractions(parsed.data.documentIds);
  const templateConfig = await getTemplateConfig('company-consolidated');
  const result = buildConsolidatedDraft(
    documents,
    templateConfig,
    parsed.data.reportDate ?? defaultReportDate()
  );

  return {
    ...result,
    requiresReview: result.issues.length > 0,
    sourceDocumentCount: new Set(documents.map((document) => document.documentId)).size,
    logicalDocumentCount: documents.length
  };
});

app.post('/v1/reports/individual', async (request, reply) => {
  const templateConfig = await getDefaultTemplateConfig();
  const parsed = individualReportSchema.safeParse({
    ...templateConfig,
    ...(request.body as Record<string, unknown>)
  });

  if (!parsed.success) {
    return reply.code(422).send({
      error: 'Invalid report payload',
      details: parsed.error.flatten()
    });
  }

  const outputKey = await generateIndividualReport(parsed.data);
  const report = await persistGeneratedReport({
    report: parsed.data,
    outputKey,
    ipAddress: request.ip
  });
  return reply.code(201).send({ reportId: report.id, outputKey });
});

app.post('/v1/reports/multi-individual', async (request, reply) => {
  const templateConfig = await getDefaultTemplateConfig();
  const parsed = multiIndividualReportSchema.safeParse({
    ...templateConfig,
    ...(request.body as Record<string, unknown>)
  });

  if (!parsed.success) {
    return reply.code(422).send({
      error: 'Invalid multi-individual report payload',
      details: parsed.error.flatten()
    });
  }

  const outputKey = await generateMultiIndividualReport(parsed.data);
  const report = await persistGeneratedMultiIndividualReport({
    report: parsed.data,
    outputKey,
    ipAddress: request.ip
  });
  return reply.code(201).send({ reportId: report.id, outputKey });
});

app.post('/v1/reports/consolidated', async (request, reply) => {
  const templateConfig = await getTemplateConfig('company-consolidated');
  const parsed = consolidatedReportSchema.safeParse({
    ...templateConfig,
    ...(request.body as Record<string, unknown>)
  });

  if (!parsed.success) {
    return reply.code(422).send({
      error: 'Invalid consolidated report payload',
      details: parsed.error.flatten()
    });
  }

  const outputKey = await generateConsolidatedReport(parsed.data);
  const report = await persistGeneratedConsolidatedReport({
    report: parsed.data,
    outputKey,
    ipAddress: request.ip
  });
  return reply.code(201).send({ reportId: report.id, outputKey });
});

app.get('/v1/reports', async () => ({ reports: await listReports() }));
app.get('/v1/audit-logs', async () => ({ auditLogs: await listAuditLogs() }));
app.get('/v1/templates', async () => ({ templates: await listTemplates() }));

app.put('/v1/templates/:key', async (request, reply) => {
  const params = request.params as { key: string };
  const parsed = reportTemplateUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(422).send({
      error: 'Invalid template payload',
      details: parsed.error.flatten()
    });
  }

  try {
    const template = await updateTemplate(params.key, parsed.data);
    return { template };
  } catch {
    return reply.code(404).send({ error: 'Template not found' });
  }
});

app.get('/v1/reports/download', async (request, reply) => {
  const query = request.query as { key?: string };
  if (!query.key) return reply.code(400).send({ error: 'Report key is required' });

  const storageRoot = resolve(env.STORAGE_DIR);
  const filePath = resolve(storageRoot, query.key);
  if (!filePath.startsWith(`${storageRoot}${sep}`)
    || extname(filePath).toLowerCase() !== '.docx') {
    return reply.code(400).send({ error: 'Invalid report key' });
  }

  try {
    const file = await readFile(filePath);
    return reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      .header('Content-Disposition', `attachment; filename="${basename(filePath)}"`)
      .send(file);
  } catch {
    return reply.code(404).send({ error: 'Report not found' });
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const resolved = resolveHttpError(error);
  reply.code(resolved.statusCode).send({
    error: resolved.statusCode === 500 ? 'Internal server error' : resolved.message,
    requestId: request.id
  });
});

app.addHook('onClose', async () => {
  await prisma.$disconnect();
});

await app.listen({ host: '0.0.0.0', port: env.PORT });
