-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "signatureUrl" TEXT,
ADD COLUMN "certificateBackgroundUrl" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "meetingLink" TEXT;

-- CreateTable
CREATE TABLE "Clue" (
    "id" TEXT NOT NULL,
    "riddle" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "workId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clue_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
