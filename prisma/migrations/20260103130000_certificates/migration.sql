-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('EVENT', 'TRAIL', 'VISIT', 'COURSE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('VALID', 'REVOKED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "certificateBackgroundUrl" TEXT,
ADD COLUMN "certificateText" TEXT,
ADD COLUMN "minMinutesForCertificate" INTEGER;

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "relatedId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CertificateStatus" NOT NULL DEFAULT 'VALID',
    "metadata" JSONB,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_code_key" ON "Certificate"("code");

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
