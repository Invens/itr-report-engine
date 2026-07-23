import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import type { ItrExtraction } from '@itr/contracts';
import {
  individualReportSchema,
  reportTemplateUpdateSchema
} from '@itr/contracts';
import { env } from './config.js';
import { persistUpload, extractPdfText } from './document-service.js';
import { extractItrWithDeepSeek } from './deepseek.js';
import { validateExtraction, type ValidationIssue } from './validation.js';
import { generateIndividualReport } from './report-generator.js';
import { prisma } from './database.js';
import {
  ensureDefaultTemplate,
  getDefaultTemplateConfig,
  listAuditLogs,
  listReports,
  listTemplates,
  persistExtraction,
  persistGeneratedReport,
  updateTemplate
} from './persistence.js';

type ExtractionResponseItem = {
  id: string;
  documentId: string;
  file: string;
  storageKey: string;
  extraction: ItrExtraction;
  issues: ValidationIssue[];
  requiresReview: boolean;
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

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.pan', '*.gstin']
  },
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
  bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024
});

await app.register(helmet, { crossOriginResourcePolicy: { policy: 'same-site' } });
await app.register(cors, { origin: env.WEB_URL, credentials: true });
await app.register(multipart, {
  limits: { files: 20, fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  throwFileSizeLimit: true
});

await ensureDefaultTemplate();

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
    if (part.mimetype !== 'application/pdf' || extname(part.filename).toLowerCase() !== '.pdf') {
      return reply.code(415).send({ error: `Unsupported file: ${part.filename}. Only PDF is accepted.` });
    }

    const buffer = await part.toBuffer();
    const stored = await persistUpload(buffer, part.filename);
    const text = await extractPdfText(stored.storageKey);
    const extraction = await extractItrWithDeepSeek(text);
    const issues = validateExtraction(extraction);
    const document = await persistExtraction({
      originalName: part.filename,
      mimeType: part.mimetype,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      extraction,
      issues,
      ipAddress: request.ip
    });

    results.push({
      id: randomUUID(),
      documentId: document.id,
      file: part.filename,
      storageKey: stored.storageKey,
      extraction,
      issues,
      requiresReview: issues.some((issue) => issue.severity === 'ERROR' || issue.severity === 'WARNING')
    });
  }

  if (results.length === 0) {
    return reply.code(400).send({ error: 'No PDF files were uploaded' });
  }

  return { results };
});

app.post('/v1/reports/individual', async (request, reply) => {
  const templateConfig = await getDefaultTemplateConfig();
  const parsed = individualReportSchema.safeParse({
    ...templateConfig,
    ...(request.body as Record<string, unknown>)
  });

  if (!parsed.success) {
    return reply.code(422).send({ error: 'Invalid report payload', details: parsed.error.flatten() });
  }

  const outputKey = await generateIndividualReport(parsed.data);
  const report = await persistGeneratedReport({
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
    return reply.code(422).send({ error: 'Invalid template payload', details: parsed.error.flatten() });
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
  if (!query.key) {
    return reply.code(400).send({ error: 'Report key is required' });
  }

  const storageRoot = resolve(env.STORAGE_DIR);
  const filePath = resolve(storageRoot, query.key);
  if (!filePath.startsWith(`${storageRoot}${sep}`) || extname(filePath).toLowerCase() !== '.docx') {
    return reply.code(400).send({ error: 'Invalid report key' });
  }

  try {
    const file = await readFile(filePath);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
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
