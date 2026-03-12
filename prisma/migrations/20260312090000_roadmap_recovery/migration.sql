-- Migration: Gamification & Roadmap 2026 Recovery
-- This migration fixes the 500 errors by creating all tables missing from the previous migrations.

-- CreateEnums
DO $$ BEGIN
    CREATE TYPE "SkinRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'EXCLUSIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "BadgeStatus" AS ENUM ('PENDING', 'APPROVED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IN_EXECUTION', 'COMPLETED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INSCRIPTIONS_OPEN', 'INSCRIPTIONS_CLOSED', 'EVALUATION', 'RESULTS_PUBLISHED', 'FINISHED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "AccessibilityServiceType" AS ENUM ('LIBRAS_INTERPRETATION', 'AUDIO_DESCRIPTION', 'CAPTIONING', 'BRAILLE', 'TACTILE_MODEL', 'EASY_READING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Fix missing AccessibilityProvider (required by previous broken migration)
CREATE TABLE IF NOT EXISTS "AccessibilityProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "description" TEXT,
    "services" "AccessibilityServiceType"[],
    "rating" DOUBLE PRECISION,
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    "userId" TEXT,
    "asaasWalletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessibilityProvider_pkey" PRIMARY KEY ("id")
);

-- Cultural Projects & Public Notices
CREATE TABLE IF NOT EXISTS "PublicNotice" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "objectives" TEXT,
    "requirements" TEXT,
    "publishDate" TIMESTAMP(3),
    "inscriptionStart" TIMESTAMP(3) NOT NULL,
    "inscriptionEnd" TIMESTAMP(3) NOT NULL,
    "evaluationEnd" TIMESTAMP(3),
    "resultsDate" TIMESTAMP(3),
    "executionEnd" TIMESTAMP(3),
    "totalBudget" DECIMAL(12,2),
    "maxPerProject" DECIMAL(10,2),
    "minPerProject" DECIMAL(10,2),
    "culturalCategories" TEXT[],
    "targetRegions" TEXT[],
    "status" "NoticeStatus" NOT NULL DEFAULT 'DRAFT',
    "documentUrl" TEXT,
    "attachments" JSONB,
    "requiresAccessibilityPlan" BOOLEAN NOT NULL DEFAULT true,
    "showScoresInResults" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CulturalProject" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "justification" TEXT,
    "culturalCategory" TEXT,
    "targetRegion" TEXT,
    "targetAudience" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "requestedBudget" DECIMAL(10,2),
    "approvedBudget" DECIMAL(10,2),
    "expectedAudience" INTEGER,
    "actualAudience" INTEGER,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "proposalUrl" TEXT,
    "attachments" JSONB,
    "accessibilityPlan" JSONB,
    "aiAnalysis" JSONB,
    "aiAnalyzedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "humanScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "noticeId" TEXT,
    "proponentId" TEXT NOT NULL,
    "eventId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CulturalProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AccessibilityExecution" (
    "id" TEXT NOT NULL,
    "serviceType" "AccessibilityServiceType" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedBy" TEXT,
    "requestNotes" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedBudget" DECIMAL(8,2),
    "providerId" TEXT,
    "executedAt" TIMESTAMP(3),
    "executionNotes" TEXT,
    "deliverables" JSONB,
    "validatedAt" TIMESTAMP(3),
    "validatedBy" TEXT,
    "validationStatus" TEXT,
    "validationNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "projectId" TEXT,
    "eventId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessibilityExecution_pkey" PRIMARY KEY ("id")
);

-- Gamification System (My tables)
CREATE TABLE IF NOT EXISTS "CharacterBase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterBase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Skin" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "xpCost" INTEGER NOT NULL,
    "rarity" "SkinRarity" NOT NULL DEFAULT 'COMMON',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eventOnly" BOOLEAN NOT NULL DEFAULT false,
    "spaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Skin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VisitorSkin" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "equipped" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VisitorSkin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BadgeRequest" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "skinImageUrl" TEXT NOT NULL,
    "xpAtRequest" INTEGER NOT NULL,
    "status" "BadgeStatus" NOT NULL DEFAULT 'PENDING',
    "addressName" TEXT NOT NULL,
    "addressStreet" TEXT NOT NULL,
    "addressCity" TEXT NOT NULL,
    "addressState" TEXT NOT NULL,
    "addressZip" TEXT NOT NULL,
    "trackingCode" TEXT,
    "pdfUrl" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    CONSTRAINT "BadgeRequest_pkey" PRIMARY KEY ("id")
);

-- Community, Quizzes, Routes, Conversations, Messages
CREATE TABLE IF NOT EXISTS "CommunityPost" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Quiz" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuizQuestion" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Route" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "producerId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkSubmission" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "userId" TEXT NOT NULL,
    "spaceId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FamilyProfile" (
    "id" TEXT NOT NULL,
    "familyName" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "audioUrl" TEXT,
    "spaceId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilyProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FamilyEvent" (
    "id" TEXT NOT NULL,
    "familyProfileId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "people" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FamilyEvent_pkey" PRIMARY KEY ("id")
);

-- Alter Tables (Add columns)
DO $$ BEGIN
    ALTER TABLE "VisitorRPG" ADD COLUMN "selectedCharacterId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Indexes & Unique Constraints
CREATE UNIQUE INDEX IF NOT EXISTS "VisitorSkin_visitorId_skinId_key" ON "VisitorSkin"("visitorId", "skinId");
CREATE UNIQUE INDEX IF NOT EXISTS "AccessibilityProvider_userId_key" ON "AccessibilityProvider"("userId");

-- Foreign Keys (Ensuring they exist)
ALTER TABLE "AccessibilityProvider" DROP CONSTRAINT IF EXISTS "AccessibilityProvider_tenantId_fkey";
ALTER TABLE "AccessibilityProvider" ADD CONSTRAINT "AccessibilityProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccessibilityProvider" DROP CONSTRAINT IF EXISTS "AccessibilityProvider_userId_fkey";
ALTER TABLE "AccessibilityProvider" ADD CONSTRAINT "AccessibilityProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CharacterBase" DROP CONSTRAINT IF EXISTS "CharacterBase_tenantId_fkey";
ALTER TABLE "CharacterBase" ADD CONSTRAINT "CharacterBase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitorRPG" DROP CONSTRAINT IF EXISTS "VisitorRPG_selectedCharacterId_fkey";
ALTER TABLE "VisitorRPG" ADD CONSTRAINT "VisitorRPG_selectedCharacterId_fkey" FOREIGN KEY ("selectedCharacterId") REFERENCES "CharacterBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Skin" DROP CONSTRAINT IF EXISTS "Skin_tenantId_fkey";
ALTER TABLE "Skin" ADD CONSTRAINT "Skin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitorSkin" DROP CONSTRAINT IF EXISTS "VisitorSkin_visitorId_fkey";
ALTER TABLE "VisitorSkin" ADD CONSTRAINT "VisitorSkin_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitorSkin" DROP CONSTRAINT IF EXISTS "VisitorSkin_skinId_fkey";
ALTER TABLE "VisitorSkin" ADD CONSTRAINT "VisitorSkin_skinId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Skin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BadgeRequest" DROP CONSTRAINT IF EXISTS "BadgeRequest_visitorId_fkey";
ALTER TABLE "BadgeRequest" ADD CONSTRAINT "BadgeRequest_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BadgeRequest" DROP CONSTRAINT IF EXISTS "BadgeRequest_tenantId_fkey";
ALTER TABLE "BadgeRequest" ADD CONSTRAINT "BadgeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PublicNotice" DROP CONSTRAINT IF EXISTS "PublicNotice_tenantId_fkey";
ALTER TABLE "PublicNotice" ADD CONSTRAINT "PublicNotice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CulturalProject" DROP CONSTRAINT IF EXISTS "CulturalProject_noticeId_fkey";
ALTER TABLE "CulturalProject" ADD CONSTRAINT "CulturalProject_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "PublicNotice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CulturalProject" DROP CONSTRAINT IF EXISTS "CulturalProject_proponentId_fkey";
ALTER TABLE "CulturalProject" ADD CONSTRAINT "CulturalProject_proponentId_fkey" FOREIGN KEY ("proponentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CulturalProject" DROP CONSTRAINT IF EXISTS "CulturalProject_tenantId_fkey";
ALTER TABLE "CulturalProject" ADD CONSTRAINT "CulturalProject_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AccessibilityExecution" DROP CONSTRAINT IF EXISTS "AccessibilityExecution_providerId_fkey";
ALTER TABLE "AccessibilityExecution" ADD CONSTRAINT "AccessibilityExecution_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AccessibilityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccessibilityExecution" DROP CONSTRAINT IF EXISTS "AccessibilityExecution_projectId_fkey";
ALTER TABLE "AccessibilityExecution" ADD CONSTRAINT "AccessibilityExecution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CulturalProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AccessibilityExecution" DROP CONSTRAINT IF EXISTS "AccessibilityExecution_tenantId_fkey";
ALTER TABLE "AccessibilityExecution" ADD CONSTRAINT "AccessibilityExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversations & Messages FKs
ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_producerId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_producerId_fkey" FOREIGN KEY ("producerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_providerId_fkey";
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AccessibilityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_conversationId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WorkSubmissions & Family
ALTER TABLE "WorkSubmission" DROP CONSTRAINT IF EXISTS "WorkSubmission_userId_fkey";
ALTER TABLE "WorkSubmission" ADD CONSTRAINT "WorkSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkSubmission" DROP CONSTRAINT IF EXISTS "WorkSubmission_spaceId_fkey";
ALTER TABLE "WorkSubmission" ADD CONSTRAINT "WorkSubmission_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkSubmission" DROP CONSTRAINT IF EXISTS "WorkSubmission_tenantId_fkey";
ALTER TABLE "WorkSubmission" ADD CONSTRAINT "WorkSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FamilyProfile" DROP CONSTRAINT IF EXISTS "FamilyProfile_spaceId_fkey";
ALTER TABLE "FamilyProfile" ADD CONSTRAINT "FamilyProfile_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FamilyProfile" DROP CONSTRAINT IF EXISTS "FamilyProfile_tenantId_fkey";
ALTER TABLE "FamilyProfile" ADD CONSTRAINT "FamilyProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FamilyEvent" DROP CONSTRAINT IF EXISTS "FamilyEvent_familyProfileId_fkey";
ALTER TABLE "FamilyEvent" ADD CONSTRAINT "FamilyEvent_familyProfileId_fkey" FOREIGN KEY ("familyProfileId") REFERENCES "FamilyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
