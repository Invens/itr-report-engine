CREATE TABLE "ReportTemplate" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reportType" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportTemplate_key_key" ON "ReportTemplate"("key");
CREATE INDEX "ReportTemplate_reportType_idx" ON "ReportTemplate"("reportType");
CREATE INDEX "ReportTemplate_isActive_idx" ON "ReportTemplate"("isActive");
CREATE INDEX "Document_createdAt_idx" ON "Document"("createdAt");
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");
CREATE INDEX "Report_status_idx" ON "Report"("status");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
