# ITR Report Engine

Production-oriented monorepo for uploading Indian income-tax, Form 26AS, GST and audited-financial-statement PDFs; extracting structured source data with DeepSeek and local OCR fallback; validating and reconciling records; reviewing a draft; and generating verification reports in Microsoft Word format.

## Stack

- Next.js 16 standalone dashboard
- Fastify 5 API
- DeepSeek structured JSON extraction
- Local Poppler and Tesseract OCR fallback
- PostgreSQL 16 with Prisma migrations
- Redis 7
- Shared Zod contracts
- Deterministic ITR, tax-credit, GST and financial-statement reconciliation rules
- DOCX report generation
- Docker Compose, Coolify and GitHub Actions

## Supported report workflows

### Individual ITR verification

Upload one or more ITR acknowledgement PDFs. The engine separates taxpayers using PAN and legal name, keeps assessment years newest first, and selects the latest revised or updated filing for each assessment year.

The reviewer can generate:

- a separate Word report for each taxpayer; or
- one consolidated Word report with a common header/signature and a separate ITR section for every PAN.

### Company consolidated verification

Upload one company bundle containing any supported combination of:

- company ITR acknowledgements and complete ITR returns;
- director or key-person ITR acknowledgements/returns;
- Form 26AS or Annual Tax Statements;
- monthly GSTR-1, GSTR-1A and GSTR-3B returns for one or more state GSTINs;
- audited Balance Sheet and Profit and Loss statements.

The engine classifies each physical PDF, splits merged GST PDFs into logical monthly returns, groups records by PAN/GSTIN, builds a human-review draft and generates one report containing company/director ITR sections, state-wise GST reconciliation, Form 26AS observations, financial-statement versus ITR-6 comparison and review remarks.

## Learned deterministic rules

- Legal names come from the tax return, PAN or tax statement, not filenames.
- Every taxpayer is isolated by PAN; every state GST registration is isolated by GSTIN.
- Section 139(4) is stored as `BELATED`, not revised.
- For revised or updated returns, the final table uses the latest filing while retaining original filing metadata when available.
- Total income, current-year business loss, accounting PBT, PAT and taxable business income are distinct fields.
- Form 26AS TDS, TCS, advance tax and self-assessment tax remain separate and are compared with the matching PAN/assessment-year ITR.
- A self-assessment-tax amount claimed in an ITR but not found in Form 26AS is surfaced for review.
- GSTR-1 reconciliation uses final outward liability, not gross invoice value or HSN summary.
- GSTR-1A adjustments are retained even when turnover is zero and tax changes.
- Negative amendments and credit notes remain negative.
- GSTR-3B gross ITC, reversal and net ITC remain separate.
- Merged GST PDFs are split using return headers; filename and physical page order do not determine the tax period.
- Audited statement units (`RUPEES`, `HUNDREDS`, `LAKHS`) are normalized internally to rupees.
- Financial differences up to the configured ₹1 tolerance are treated as rounding; larger differences require review.
- Statutory financial-statement audit and tax-audit metadata are stored separately.
- Reports use “Date of Filing”.

## Active dashboard sections

- **New report** — choose Individual ITR or Company consolidated, upload PDFs, classify/extract and review
- **Reports** — persistent report history with repeat downloads
- **Audit log** — document extraction, report generation and template-change history
- **Templates** — editable individual and consolidated report defaults

## Repository structure

```text
apps/
  api/          Fastify extraction, reconciliation, persistence and report API
  web/          Next.js dashboard and human-review workspace
packages/
  contracts/    Shared schemas and types
  database/     Prisma package, schema and migrations
docs/
  COOLIFY.md    Production deployment runbook
start.sh        Secure one-command local Docker launcher
```

## Start locally

The complete stack runs through Docker. Local Node.js, pnpm, PostgreSQL, Redis, Poppler and Tesseract installations are not required.

```bash
DEEPSEEK_API_KEY="your-key" sh ./start.sh
```

Open:

```text
http://localhost:3000
```

After the first start, the key may be stored in the ignored `.env` file, allowing subsequent starts with:

```bash
sh ./start.sh
```

The launcher checks Docker, prepares `.env`, generates a local database password, validates the DeepSeek key, applies Prisma migrations and starts PostgreSQL, Redis, Fastify and Next.js.

## OCR configuration

Scanned PDFs first pass through normal PDF text extraction. When insufficient text is detected, the API renders pages with Poppler and runs Tesseract OCR.

```env
MAX_UPLOAD_MB=25
MAX_BUNDLE_FILES=100
OCR_MAX_PAGES=25
OCR_DPI=200
```

Documents that remain unreadable are marked for manual review rather than guessed.

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

Persistent Docker volumes store PostgreSQL data, Redis data, uploaded source documents and generated Word reports.

## Coolify deployment

Use the Docker Compose build pack with:

```text
/docker-compose.coolify.yml
```

Set `DEEPSEEK_API_KEY` as a runtime-only secret and assign the domain only to the `web` service on container port `3000`. PostgreSQL, Redis, migration and API services remain private. The complete deployment procedure is in [`docs/COOLIFY.md`](docs/COOLIFY.md).

## Application flow

```text
Upload PDF bundle
      ↓
Persist and hash every physical file
      ↓
Extract PDF text or use OCR fallback
      ↓
Split merged PDFs into logical returns
      ↓
Classify ITR / Form 26AS / GST / audited statement
      ↓
DeepSeek structured source extraction
      ↓
Zod validation and deterministic checks
      ↓
Persist provenance, confidence and audit event
      ↓
Group by PAN, assessment year and GSTIN
      ↓
Build consolidated reconciliation draft
      ↓
Human review and correction
      ↓
Approve, generate, store and download DOCX
```

## Internal API

```text
GET  /health
GET  /ready
POST /v1/documents/extract
POST /v1/documents/extract-bundle
POST /v1/reports/individual
POST /v1/reports/multi-individual
POST /v1/reports/consolidated/draft
POST /v1/reports/consolidated
GET  /v1/reports
GET  /v1/reports/download?key=...
GET  /v1/audit-logs
GET  /v1/templates
PUT  /v1/templates/:key
```

Browser traffic uses the same-origin `/backend/*` proxy, so no public API port or browser-side API configuration is required.

## Safety and production notes

The engine does not silently trust AI output. Strict schemas, confidence scores, source evidence, deterministic reconciliation, relationship status, OCR mode and audit activity are persisted. Mismatches are surfaced in the review draft and are not silently corrected.

Keep secrets outside version control, deploy behind HTTPS and restrict access to trusted staff. Authentication, antivirus scanning, automated backups and object-storage integration remain additional hardening tasks before broad public exposure.
