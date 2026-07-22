# ITR Report Engine

Production-oriented monorepo for uploading Indian ITR acknowledgement PDFs, extracting structured data with DeepSeek, validating the extracted fields, separating taxpayers by PAN, and generating individual verification reports in Microsoft Word format.

## Stack

- Next.js 16 standalone dashboard
- Fastify 5 API
- DeepSeek JSON extraction
- PostgreSQL 16 with Prisma migrations
- Redis 7
- Shared Zod contracts
- DOCX report generation
- Docker Compose and GitHub Actions

## Repository structure

```text
apps/
  api/          Fastify extraction and report API
  web/          Next.js dashboard
packages/
  contracts/    Shared schemas and types
  database/     Prisma schema and migrations
```

## Start the complete application

The entire stack runs through Docker. No local Node.js, pnpm, PostgreSQL or Redis installation is required.

### One-command start

```bash
DEEPSEEK_API_KEY="your-key" docker compose up --build -d
```

Open:

```text
http://localhost:3000
```

For repeatable starts, copy `.env.example` to `.env`, add the DeepSeek key once, and then use:

```bash
docker compose up --build -d
```

The command starts and coordinates:

1. PostgreSQL
2. Redis
3. Database migration job
4. Fastify API
5. Next.js web application

The web service is the only service exposed publicly. PostgreSQL, Redis and the API remain on the private Compose network.

## Operations

```bash
# Follow application logs
docker compose logs -f web api

# Check container health
docker compose ps

# Stop without deleting stored data
docker compose down

# Stop and delete all local database/document data
docker compose down -v
```

Persistent Docker volumes are used for:

- PostgreSQL data
- Redis data
- uploaded ITR documents
- generated Word reports

## Application flow

```text
Upload PDF files
      ↓
Persist and hash each document
      ↓
Extract machine-readable PDF text
      ↓
DeepSeek structured JSON extraction
      ↓
Zod and deterministic validation
      ↓
Group documents by PAN and taxpayer name
      ↓
Human review
      ↓
Generate and download separate DOCX reports
```

## Safety rules

The engine does not silently trust AI output. DeepSeek responses must pass strict schemas, PAN and assessment-year formats are validated, financial values must be non-negative, low-confidence fields are flagged, and unknown filing types require review.

Machine-readable PDFs are supported in the current path. A PDF with insufficient text is rejected rather than guessed from incomplete data.

## Health endpoints

The web application is available at `/`.

The internal API exposes:

```text
GET /health
GET /ready
POST /v1/documents/extract
POST /v1/reports/individual
GET /v1/reports/download?key=...
```

Browser traffic uses the same-origin `/backend/*` proxy, so no public API port or browser-side API configuration is required.

## Production notes

Change `POSTGRES_PASSWORD`, keep `.env` outside version control, deploy behind HTTPS, and restrict access to trusted staff. Authentication, OCR, company/GST/ROC report sections, antivirus scanning and object-storage integration remain separate hardening milestones before exposing the system to external users.
