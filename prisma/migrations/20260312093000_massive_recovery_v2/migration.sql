-- Massive Recovery Migration v2
-- This script adds all columns missing from the main tables to sync with schema.prisma

-- 1. ENUMS RECOVERY
DO $$ BEGIN
    CREATE TYPE "TenantType" AS ENUM ('MUSEUM', 'PRODUCER', 'SECRETARIA', 'CULTURAL_SPACE', 'CITY', 'ARCHITECTURAL_LANDMARK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "EventType" AS ENUM ('WORKSHOP', 'EXHIBITION', 'SHOW', 'LECTURE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Update existing enums
ALTER TYPE "QRType" ADD VALUE IF NOT EXISTS 'TENANT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCER';

-- 2. TENANT TABLE RECOVERY
DO $$ BEGIN
    ALTER TABLE "Tenant" ADD COLUMN "type" "TenantType" NOT NULL DEFAULT 'MUSEUM';
    ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Tenant" ADD COLUMN "parentId" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "planId" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "capacityPerHour" INTEGER NOT NULL DEFAULT 50;
    ALTER TABLE "Tenant" ADD COLUMN "signatureUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "certificateBackgroundUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "welcomeAudioUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "welcomeVideoUrl" TEXT;
    -- Feature Flags
    ALTER TABLE "Tenant" ADD COLUMN "featureWorks" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureTrails" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureEvents" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureGamification" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureQRCodes" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureChatAI" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureShop" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureDonations" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureCertificates" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureReviews" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureGuestbook" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureAccessibility" BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE "Tenant" ADD COLUMN "featureMinigames" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureServices" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureTickets" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureEditais" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureProjects" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureAccessibilityMgmt" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureProviders" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureInstitutionalReports" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureEditaisSubmission" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureCuratorNotes" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureNPS" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Tenant" ADD COLUMN "featureSponsorship" BOOLEAN NOT NULL DEFAULT false;
    -- Other fields
    ALTER TABLE "Tenant" ADD COLUMN "termsOfUse" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "privacyPolicy" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "cnpj" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "legalNature" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "foundationYear" INTEGER;
    ALTER TABLE "Tenant" ADD COLUMN "typology" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "legalRepresentative" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "accessibilityResources" JSONB;
    ALTER TABLE "Tenant" ADD COLUMN "asaasWalletId" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "isCityMode" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 3. WORK TABLE RECOVERY
DO $$ BEGIN
    ALTER TABLE "Work" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Work" ADD COLUMN "technique" TEXT;
    ALTER TABLE "Work" ADD COLUMN "period" TEXT;
    ALTER TABLE "Work" ADD COLUMN "medium" TEXT;
    ALTER TABLE "Work" ADD COLUMN "dimensions" TEXT;
    ALTER TABLE "Work" ADD COLUMN "yearNumeric" INTEGER;
    ALTER TABLE "Work" ADD COLUMN "metadata" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. EVENT TABLE RECOVERY
DO $$ BEGIN
    ALTER TABLE "Event" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Event" ADD COLUMN "type" "EventType" NOT NULL DEFAULT 'OTHER';
    ALTER TABLE "Event" ADD COLUMN "instructor" TEXT;
    ALTER TABLE "Event" ADD COLUMN "materials" TEXT;
    ALTER TABLE "Event" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'PRESENTIAL';
    ALTER TABLE "Event" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
    ALTER TABLE "Event" ADD COLUMN "isOnline" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Event" ADD COLUMN "eventId" TEXT;
    ALTER TABLE "Event" ADD COLUMN "zipCode" TEXT;
    ALTER TABLE "Event" ADD COLUMN "address" TEXT;
    ALTER TABLE "Event" ADD COLUMN "number" TEXT;
    ALTER TABLE "Event" ADD COLUMN "complement" TEXT;
    ALTER TABLE "Event" ADD COLUMN "neighborhood" TEXT;
    ALTER TABLE "Event" ADD COLUMN "city" TEXT;
    ALTER TABLE "Event" ADD COLUMN "state" TEXT;
    ALTER TABLE "Event" ADD COLUMN "meetingLink" TEXT;
    ALTER TABLE "Event" ADD COLUMN "platform" TEXT;
    ALTER TABLE "Event" ADD COLUMN "producerName" TEXT;
    ALTER TABLE "Event" ADD COLUMN "producerDescription" TEXT;
    ALTER TABLE "Event" ADD COLUMN "producerLogoUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "coverImageUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "coverUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "certificateBackgroundUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "certificateText" TEXT;
    ALTER TABLE "Event" ADD COLUMN "minMinutesForCertificate" INTEGER;
    ALTER TABLE "Event" ADD COLUMN "audioUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "videoUrl" TEXT;
    ALTER TABLE "Event" ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "Event" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT';
    ALTER TABLE "Event" ADD COLUMN "customFormSchema" JSONB;
    ALTER TABLE "Event" ADD COLUMN "galleryUrls" TEXT;
    ALTER TABLE "Event" ADD COLUMN "spaceId" TEXT;
    ALTER TABLE "Event" ADD COLUMN "certificateRequiresSurvey" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 5. VISITOR TABLE RECOVERY
DO $$ BEGIN
    ALTER TABLE "Visitor" ADD COLUMN "isFake" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Visitor" ADD COLUMN "isTeacher" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 6. USER TABLE RECOVERY (Added producer fields)
DO $$ BEGIN
    ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
    ALTER TABLE "User" ADD COLUMN "termsAcceptedIp" TEXT;
    ALTER TABLE "User" ADD COLUMN "cpf" TEXT;
    ALTER TABLE "User" ADD COLUMN "phone" TEXT;
    ALTER TABLE "User" ADD COLUMN "bio" TEXT;
    ALTER TABLE "User" ADD COLUMN "website" TEXT;
    ALTER TABLE "User" ADD COLUMN "preferences" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 7. RE-APPLY CONSTRAINTS (For parentId, planId, spaceId)
ALTER TABLE "Tenant" DROP CONSTRAINT IF EXISTS "Tenant_parentId_fkey";
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_spaceId_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_eventId_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
