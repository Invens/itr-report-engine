# ITR Report Engine

Production-oriented monorepo for uploading Indian ITR acknowledgement PDFs, extracting structured data with DeepSeek, validating the extracted fields, separating taxpayers by PAN, and generating individual verification reports in Microsoft Word format.

## Stack

- Next.js 16 dashboard
- Fastify 5 API
- DeepSeek OpenAI-compatible chat API with JSON output
- PostgreSQL and Prisma
- Redis and BullMQ-ready infrastructure
- Zod contracts and deterministic validation
- `docx` Word generation
- Docker Compose and GitHub Actions

## Applications

```text
apps/web       Next.js upload, review and generation dashboard
apps/api       Fastify extraction and report-generation API
packages/contracts  Shared Zod schemas and TypeScript types
packages/database   Prisma schema and persistence model
```

## Local setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:dev
pnpm dev
```

Open the dashboard at `http://localhost:3000`. The API listens at `http://localhost:4000`.

## Required environment variables

```text
DATABASE_URL
REDIS_URL
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
JWT_SECRET
STORAGE_DIR
NEXT_PUBLIC_API_URL
```

## Processing safeguards

The engine does not silently accept AI output. DeepSeek responses are validated against strict schemas, financial values must be non-negative, low-confidence fields are flagged, unknown filing types require review, and reports are grouped by PAN plus normalized taxpayer name.

The initial implementation accepts machine-readable ITR acknowledgement PDFs. Scanned PDFs are deliberately rejected for manual/OCR review rather than guessed from incomplete text.

## API

### Extract ITR acknowledgements

`POST /v1/documents/extract` as multipart form data with one or more `files` fields.

### Generate an individual Word report

`POST /v1/reports/individual` with a reviewed report payload matching `individualReportSchema`.

### Health check

`GET /health`

## Production roadmap

The repository includes the core extraction and DOCX path. Before public deployment, complete authentication, persisted workflow routes, BullMQ workers, S3-compatible object storage, signed downloads, template upload/versioning, OCR fallback, company/GST/ROC sections, antivirus scanning, retention policies, and end-to-end tests.
