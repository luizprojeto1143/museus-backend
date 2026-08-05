CREATE TYPE "ProjectAppealType" AS ENUM ('APPEAL', 'COUNTER_ARGUMENT');
CREATE TYPE "ProjectAppealStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'PARTIALLY_ACCEPTED');
CREATE TYPE "ProjectTermStatus" AS ENUM ('PENDING_SIGNATURE', 'SIGNED', 'CANCELED');
CREATE TYPE "ProjectAccountabilityStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ADJUSTMENTS_REQUIRED');

CREATE TABLE "ProjectAppeal" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "noticeId" TEXT,
  "tenantId" TEXT NOT NULL,
  "proponentId" TEXT NOT NULL,
  "type" "ProjectAppealType" NOT NULL DEFAULT 'APPEAL',
  "status" "ProjectAppealStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reason" TEXT NOT NULL,
  "requestedAdjustment" TEXT,
  "response" TEXT,
  "counterResponse" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAppeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectTerm" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "proponentId" TEXT NOT NULL,
  "status" "ProjectTermStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
  "title" TEXT NOT NULL,
  "termsText" TEXT NOT NULL,
  "documentUrl" TEXT,
  "signedDocumentUrl" TEXT,
  "signedAt" TIMESTAMP(3),
  "signedByIp" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectAccountability" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "proponentId" TEXT NOT NULL,
  "status" "ProjectAccountabilityStatus" NOT NULL DEFAULT 'DRAFT',
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "executionSummary" TEXT,
  "audienceReached" INTEGER,
  "amountSpent" DECIMAL(12,2),
  "documents" JSONB,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectAccountability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectAppeal_projectId_idx" ON "ProjectAppeal"("projectId");
CREATE INDEX "ProjectAppeal_noticeId_idx" ON "ProjectAppeal"("noticeId");
CREATE INDEX "ProjectAppeal_tenantId_status_idx" ON "ProjectAppeal"("tenantId", "status");
CREATE INDEX "ProjectAppeal_proponentId_idx" ON "ProjectAppeal"("proponentId");

CREATE INDEX "ProjectTerm_projectId_idx" ON "ProjectTerm"("projectId");
CREATE INDEX "ProjectTerm_tenantId_status_idx" ON "ProjectTerm"("tenantId", "status");
CREATE INDEX "ProjectTerm_proponentId_idx" ON "ProjectTerm"("proponentId");

CREATE INDEX "ProjectAccountability_projectId_idx" ON "ProjectAccountability"("projectId");
CREATE INDEX "ProjectAccountability_tenantId_status_idx" ON "ProjectAccountability"("tenantId", "status");
CREATE INDEX "ProjectAccountability_proponentId_idx" ON "ProjectAccountability"("proponentId");

ALTER TABLE "ProjectAppeal"
  ADD CONSTRAINT "ProjectAppeal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CulturalProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectAppeal_proponentId_fkey" FOREIGN KEY ("proponentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectAppeal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectTerm"
  ADD CONSTRAINT "ProjectTerm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CulturalProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectTerm_proponentId_fkey" FOREIGN KEY ("proponentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectTerm_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAccountability"
  ADD CONSTRAINT "ProjectAccountability_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CulturalProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectAccountability_proponentId_fkey" FOREIGN KEY ("proponentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectAccountability_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
