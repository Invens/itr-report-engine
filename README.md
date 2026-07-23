# ITR Report Engine

Production-oriented monorepo for uploading Indian ITR acknowledgement PDFs, extracting structured data with DeepSeek, validating extracted fields, separating taxpayers by PAN, and generating individual verification reports in Microsoft Word format.

## Stack

- Next.js 16 standalone dashboard
- Fastify 5 API
- DeepSeek structured JSON extraction
- PostgreSQL 16 with Prisma migrations
- Redis 7
- Shared Zod contracts
- DOCX report generation
- Docker Compose, Coolify and GitHub Actions

## Active dashboard sections

- **New report** — upload PDFs, extract values, separate taxpayers, and generate DOCX reports
- **Reports** — persistent report history with repeat downloads
- **Audit log** — document extraction, report generation, and template-change history
- **Templates** — editable bank, branch, UDIN, reference, firm, and signing defaults

## Repository structure

```text
apps/
  api/          Fastify extraction, persistence and report API
  web/          Next.js dashboard
packages/
  contracts/    Shared schemas and types
  database/     Prisma package, schema and migrations
docs/
  COOLIFY.md    Production deployment runbook
start.sh        Secure one-command local Docker launcher
```

## Start the complete application locally

The complete stack runs through Docker. Local Node.js, pnpm, PostgreSQL and Redis installations are not required.

```bash
DEEPSEEK_API_KEY="your-key" sh ./start.sh
```

The launcher:

1. checks Docker and Docker Compose;
2. creates `.env` from `.env.example` when needed;
3. generates a strong PostgreSQL password and stores it only in the ignored `.env` file;
4. validates that a DeepSeek key is available;
5. builds and starts the complete application.

Open:

```text
http://localhost:3000
```

After the first start, the key may be stored in `.env`, allowing subsequent starts with:

```bash
sh ./start.sh
```

The stack starts and coordinates:

1. PostgreSQL
2. Redis
3. Prisma migration job
4. Fastify API
5. Next.js web application

The web service is the only service exposed publicly. PostgreSQL, Redis and the API remain on the private Compose network.

## Updating an existing checkout

```bash
git pull
docker compose down --remove-orphans
sh ./start.sh
```

## Operations

```bash
# Follow application logs
docker compose --env-file .env logs -f web api

# Check container health
docker compose --env-file .env ps

# Stop without deleting stored data
docker compose --env-file .env down

# Stop and delete all local database/document data
docker compose --env-file .env down -v
```

Persistent Docker volumes are used for:

- PostgreSQL data, report history, templates, and audit logs
- Redis data
- uploaded ITR documents
- generated Word reports

## Coolify deployment

Use the dedicated production compose file:

```text
/docker-compose.coolify.yml
```

The complete deployment procedure is documented in [`docs/COOLIFY.md`](docs/COOLIFY.md).

The Coolify stack uses generated PostgreSQL and Redis passwords, private internal services, persistent named volumes, health checks, and a one-time migration container. Only the `web` service should receive a domain on container port `3000`.

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
Persist document and audit event
      ↓
Group documents by PAN and taxpayer name
      ↓
Human review
      ↓
Generate, store and download DOCX report
```

## Safety rules

The engine does not silently trust AI output. DeepSeek responses must pass strict schemas, PAN and assessment-year formats are validated, financial values must be non-negative, low-confidence fields are flagged, and unknown filing types require review.

Machine-readable PDFs are supported in the current path. A PDF with insufficient text is rejected rather than guessed from incomplete data.

## Internal API

```text
GET  /health
GET  /ready
POST /v1/documents/extract
POST /v1/reports/individual
GET  /v1/reports
GET  /v1/reports/download?key=...
GET  /v1/audit-logs
GET  /v1/templates
PUT  /v1/templates/:key
```

Browser traffic uses the same-origin `/backend/*` proxy, so no public API port or browser-side API configuration is required.

## Production notes

Keep secrets outside version control, deploy behind HTTPS, and restrict access to trusted staff. Authentication, OCR, company/GST/ROC report sections, antivirus scanning, automated backups and object-storage integration remain additional hardening milestones before broad public exposure.
