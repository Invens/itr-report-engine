import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, sep } from 'node:path';
import { env } from './config.js';
import { persistUpload, extractPdfText } from './document-service.js';
import { extractItrWithDeepSeek } from './deepseek.js';
import { validateExtraction } from './validation.js';
import { generateIndividualReport } from './report-generator.js';
import { individualReportSchema } from '@itr/contracts';

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

app.get('/health', async () => ({ status: 'ok', service: 'itr-api', timestamp: new Date().toISOString() }));
app.get('/ready', async () => ({ status: 'ready', service: 'itr-api' }));

app.post('/v1/documents/extract', async (request, reply) => {
  const parts = request.files();
  const results = [];

  for await (const part of parts) {
    if (part.type !== 'file') continue;
    if (part.mimetype !== 'application/pdf' || extname(part.filename).toLowerCase() !== '.pdf') {
      return reply.code(415).send({ error: `Unsupported file: ${part.filename}. Only PDF is accepted.` });
    }
    const buffer = await part.toBuffer();
    const stored = await persistUpload(buffer, part.filename);
    const text = await extractPdfText(stored.storageKey);
    const extraction = await extractItrWithDeepSeek(text);
    const issues = validateExtraction(extraction);
    results.push({ id: randomUUID(), file: part.filename, storageKey: stored.storageKey, extraction, issues, requiresReview: issues.some((i) => i.severity === 'ERROR' || i.severity === 'WARNING') });
  }

  if (!results.length) return reply.code(400).send({ error: 'No PDF files were uploaded' });
  return { results };
});

app.post('/v1/reports/individual', async (request, reply) => {
  const parsed = individualReportSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(422).send({ error: 'Invalid report payload', details: parsed.error.flatten() });
  const outputKey = await generateIndividualReport(parsed.data);
  return reply.code(201).send({ outputKey });
});

app.get('/v1/reports/download', async (request, reply) => {
  const query = request.query as { key?: string };
  if (!query.key) return reply.code(400).send({ error: 'Report key is required' });

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
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  reply.code(status).send({ error: status === 500 ? 'Internal server error' : error.message, requestId: request.id });
});

await app.listen({ host: '0.0.0.0', port: env.PORT });
