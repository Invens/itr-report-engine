CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REVIEWER', 'OPERATOR');
CREATE TYPE "EntityType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'VERIFIED', 'FAILED');
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'APPROVED', 'GENERATED', 'FAILED');
CREATE TYPE "FilingType" AS ENUM ('ORIGINAL', 'REVISED', 'UPDATED', 'UNKNOWN');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientEntity" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pan" TEXT,
  "gstin" TEXT,
  "cin" TEXT,
  "entityType" "EntityType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientEntity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Document" (
  "id" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "documentType" TEXT,
  "assessmentYear" TEXT,
  "acknowledgement" TEXT,
  "filingDate" TIMESTAMP(3),
  "filingType" "FilingType" NOT NULL DEFAULT 'UNKNOWN',
  "totalIncome" DECIMAL(18,2),
  "taxPayable" DECIMAL(18,2),
  "taxesPaid" DECIMAL(18,2),
  "extractedJson" JSONB,
  "confidenceJson" JSONB,
  "validationJson" JSONB,
  "errorMessage" TEXT,
  "clientEntityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Report" (
  "id" TEXT NOT NULL,
  "clientEntityId" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "payload" JSONB NOT NULL,
  "outputKey" TEXT,
  "approvedAt" TIMESTAMP(3),
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");
CREATE UNIQUE INDEX "Document_sha256_key" ON "Document"("sha256");
CREATE INDEX "ClientEntity_pan_idx" ON "ClientEntity"("pan");
CREATE INDEX "ClientEntity_gstin_idx" ON "ClientEntity"("gstin");
CREATE INDEX "ClientEntity_cin_idx" ON "ClientEntity"("cin");
CREATE INDEX "Document_assessmentYear_idx" ON "Document"("assessmentYear");
CREATE INDEX "Document_acknowledgement_idx" ON "Document"("acknowledgement");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_clientEntityId_fkey"
  FOREIGN KEY ("clientEntityId") REFERENCES "ClientEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Report"
  ADD CONSTRAINT "Report_clientEntityId_fkey"
  FOREIGN KEY ("clientEntityId") REFERENCES "ClientEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
