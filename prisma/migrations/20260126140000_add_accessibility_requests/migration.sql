-- CreateTable
CREATE TABLE "AccessibilityRequest" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "masterNotes" TEXT,
    "workId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessibilityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessibilityRequest_tenantId_idx" ON "AccessibilityRequest"("tenantId");

-- CreateIndex
CREATE INDEX "AccessibilityRequest_status_idx" ON "AccessibilityRequest"("status");

-- AddForeignKey
ALTER TABLE "AccessibilityRequest" ADD CONSTRAINT "AccessibilityRequest_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessibilityRequest" ADD CONSTRAINT "AccessibilityRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
