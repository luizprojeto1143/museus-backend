-- Sprint 15: Central de Taxas da Plataforma
-- CreateEnum
CREATE TYPE "PlatformFeeSource" AS ENUM ('TICKET', 'THEATER', 'SHOP', 'DONATION', 'MEMBERSHIP', 'SPONSORSHIP_SHARED', 'SPONSORSHIP_EXCLUSIVE', 'SERVICE', 'ACCESSIBILITY', 'MARKETPLACE', 'GUIDE', 'PROVIDER_SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "FeePaidBy" AS ENUM ('BUYER', 'SELLER');

-- AlterTable
ALTER TABLE "AccessibilityExecution" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "platformFeeAmountCents" INTEGER;

-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "feePaidBy" "FeePaidBy",
ADD COLUMN     "platformFeeAmountCents" INTEGER,
ADD COLUMN     "platformFeePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "FinancialLedgerEntry" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "feePaidBy" "FeePaidBy",
ADD COLUMN     "platformFeeAmountCents" INTEGER;

-- AlterTable
ALTER TABLE "FinancialTransaction" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "feePaidBy" "FeePaidBy",
ADD COLUMN     "platformFeeAmountCents" INTEGER,
ADD COLUMN     "platformFeePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "platformFeeAmountCents" INTEGER,
ADD COLUMN     "platformFeePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "feeConfigId" TEXT,
ADD COLUMN     "feePaidBy" "FeePaidBy",
ADD COLUMN     "platformFeeAmountCents" INTEGER,
ADD COLUMN     "platformFeePercent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "PlatformFeeConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "sourceType" "PlatformFeeSource" NOT NULL,
    "name" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL,
    "fixedFee" DECIMAL(10,2),
    "feePaidBy" "FeePaidBy" NOT NULL DEFAULT 'SELLER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformFeeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_tenantId_idx" ON "PlatformFeeConfig"("tenantId");

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_sourceType_idx" ON "PlatformFeeConfig"("sourceType");

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_isActive_idx" ON "PlatformFeeConfig"("isActive");

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_tenantId_sourceType_isActive_idx" ON "PlatformFeeConfig"("tenantId", "sourceType", "isActive");

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_startsAt_idx" ON "PlatformFeeConfig"("startsAt");

-- CreateIndex
CREATE INDEX "PlatformFeeConfig_endsAt_idx" ON "PlatformFeeConfig"("endsAt");

-- CreateIndex
CREATE INDEX "FinancialLedgerEntry_feeConfigId_idx" ON "FinancialLedgerEntry"("feeConfigId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_feeConfigId_idx" ON "FinancialTransaction"("feeConfigId");

-- AddForeignKey
ALTER TABLE "PlatformFeeConfig" ADD CONSTRAINT "PlatformFeeConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
