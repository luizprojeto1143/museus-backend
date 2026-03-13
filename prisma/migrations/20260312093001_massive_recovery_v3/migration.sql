-- Massive Recovery Migration v3
-- This script creates EVERYTHING that is in schema.prisma but not in the Init migration.

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE "TenantType" AS ENUM ('MUSEUM', 'PRODUCER', 'SECRETARIA', 'CULTURAL_SPACE', 'CITY', 'ARCHITECTURAL_LANDMARK');
    CREATE TYPE "EventType" AS ENUM ('WORKSHOP', 'EXHIBITION', 'SHOW', 'LECTURE', 'OTHER');
    CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'IN_EXECUTION', 'COMPLETED', 'CANCELED');
    CREATE TYPE "NoticeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INSCRIPTIONS_OPEN', 'INSCRIPTIONS_CLOSED', 'EVALUATION', 'RESULTS_PUBLISHED', 'FINISHED');
    CREATE TYPE "AccessibilityServiceType" AS ENUM ('LIBRAS_INTERPRETATION', 'AUDIO_DESCRIPTION', 'CAPTIONING', 'BRAILLE', 'TACTILE_MODEL', 'EASY_READING');
    CREATE TYPE "SkinRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'EXCLUSIVE');
    CREATE TYPE "BadgeStatus" AS ENUM ('PENDING', 'APPROVED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'REJECTED');
    CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELED', 'CHECKED_IN');
    CREATE TYPE "TicketType" AS ENUM ('FREE', 'PAID');
    CREATE TYPE "TicketStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED');
    CREATE TYPE "CertificateType" AS ENUM ('EVENT', 'TRAIL', 'VISIT', 'COURSE', 'CUSTOM');
    CREATE TYPE "CertificateStatus" AS ENUM ('VALID', 'REVOKED');
    CREATE TYPE "TriggerType" AS ENUM ('TRAIL_COMPLETED', 'EVENT_ATTENDED', 'XP_THRESHOLD', 'MANUAL');
    CREATE TYPE "AITier" AS ENUM ('BASIC', 'CONTINUOUS', 'ADVANCED');
    CREATE TYPE "SLATier" AS ENUM ('STANDARD', 'EXTENDED', 'DEDICATED');
    CREATE TYPE "SurveyQuestionType" AS ENUM ('STARS', 'TEXT', 'CHOICE', 'NPS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Update existing enums
ALTER TYPE "QRType" ADD VALUE IF NOT EXISTS 'TENANT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PRODUCER';
ALTER TYPE "CategoryType" ADD VALUE IF NOT EXISTS 'GENERAL';

-- 2. NEW TABLES (INFRASTRUCTURE & GOVERNANCE)
CREATE TABLE IF NOT EXISTS "ContractPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxActiveProjects" INTEGER NOT NULL DEFAULT 10,
    "maxAccessibilityReqs" INTEGER NOT NULL DEFAULT 5,
    "maxReportsPerMonth" INTEGER NOT NULL DEFAULT 10,
    "maxAIAnalyses" INTEGER NOT NULL DEFAULT 100,
    "maxWorks" INTEGER NOT NULL DEFAULT 50,
    "maxEvents" INTEGER NOT NULL DEFAULT 20,
    "maxChildTenants" INTEGER NOT NULL DEFAULT 0,
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "aiTier" "AITier" NOT NULL DEFAULT 'BASIC',
    "slaTier" "SLATier" NOT NULL DEFAULT 'STANDARD',
    "supportResponseHours" INTEGER NOT NULL DEFAULT 48,
    "monthlyPrice" DECIMAL(10,2),
    "hasExecutiveReports" BOOLEAN NOT NULL DEFAULT false,
    "hasLegalCompliance" BOOLEAN NOT NULL DEFAULT false,
    "hasAPIAccess" BOOLEAN NOT NULL DEFAULT false,
    "hasWhiteLabel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContractPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AIUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "analysesCount" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "File" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "usedIn" TEXT,
    "usedInId" TEXT,
    "tenantId" TEXT,
    "uploadedBy" TEXT,
    "useInAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- 3. UPDATING EXISTING TABLES (TENANT, WORK, EVENT, VISITOR, USER, BOOKING)
DO $$ BEGIN
    -- Tenant updates
    ALTER TABLE "Tenant" ADD COLUMN "type" "TenantType" NOT NULL DEFAULT 'MUSEUM';
    ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Tenant" ADD COLUMN "parentId" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "planId" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "capacityPerHour" INTEGER NOT NULL DEFAULT 50;
    ALTER TABLE "Tenant" ADD COLUMN "signatureUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "certificateBackgroundUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "welcomeAudioUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "welcomeVideoUrl" TEXT;
    ALTER TABLE "Tenant" ADD COLUMN "signatureName" TEXT; -- Extra field sometimes used
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
    -- Other Tenant fields
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

DO $$ BEGIN
    -- User updates
    ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
    ALTER TABLE "User" ADD COLUMN "termsAcceptedIp" TEXT;
    ALTER TABLE "User" ADD COLUMN "cpf" TEXT;
    ALTER TABLE "User" ADD COLUMN "phone" TEXT;
    ALTER TABLE "User" ADD COLUMN "bio" TEXT;
    ALTER TABLE "User" ADD COLUMN "website" TEXT;
    ALTER TABLE "User" ADD COLUMN "preferences" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    -- Work updates
    ALTER TABLE "Work" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Work" ADD COLUMN "technique" TEXT;
    ALTER TABLE "Work" ADD COLUMN "period" TEXT;
    ALTER TABLE "Work" ADD COLUMN "medium" TEXT;
    ALTER TABLE "Work" ADD COLUMN "dimensions" TEXT;
    ALTER TABLE "Work" ADD COLUMN "yearNumeric" INTEGER;
    ALTER TABLE "Work" ADD COLUMN "metadata" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Event Updates - BE CAREFUL WITH CONFLICTS
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

DO $$ BEGIN
    -- Trail updates
    ALTER TABLE "Trail" ADD COLUMN "deletedAt" TIMESTAMP(3);
    ALTER TABLE "Trail" ADD COLUMN "imageUrl" TEXT;
    ALTER TABLE "Trail" ADD COLUMN "audioUrl" TEXT;
    ALTER TABLE "Trail" ADD COLUMN "videoUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    -- Visitor updates
    ALTER TABLE "Visitor" ADD COLUMN "isFake" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "Visitor" ADD COLUMN "isTeacher" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
    -- Booking updates
    ALTER TABLE "Booking" ADD COLUMN "spaceId" TEXT;
    ALTER TABLE "Booking" ADD COLUMN "startTime" TIMESTAMP(3);
    ALTER TABLE "Booking" ADD COLUMN "endTime" TIMESTAMP(3);
    ALTER TABLE "Booking" ADD COLUMN "purpose" TEXT;
    ALTER TABLE "Booking" ADD COLUMN "inPersonServiceId" TEXT;
    ALTER TABLE "Booking" ADD COLUMN "participants" INTEGER;
    ALTER TABLE "Booking" ADD COLUMN "eventId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. NEW TABLES (SERVICES, SPACES, CERTIFICATES)
CREATE TABLE IF NOT EXISTS "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 10,
    "type" TEXT NOT NULL DEFAULT 'ROOM',
    "resources" JSONB,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InPersonService" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InPersonService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TenantInPersonService" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "inPersonServiceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantInPersonService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CertificateTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backgroundUrl" TEXT,
    "elements" JSONB NOT NULL,
    "dimensions" JSONB,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CertificateTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Certificate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "CertificateType" NOT NULL,
    "relatedId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CertificateStatus" NOT NULL DEFAULT 'VALID',
    "metadata" JSONB,
    "templateId" TEXT,
    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CertificateRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "conditions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "actionTemplateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CertificateRule_pkey" PRIMARY KEY ("id")
);

-- 5. NEW TABLES (SOCIAL & FEEDBACK)
CREATE TABLE IF NOT EXISTS "Favorite" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "workId" TEXT,
    "trailId" TEXT,
    "eventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Review" (
    "id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "visitorId" TEXT NOT NULL,
    "workId" TEXT,
    "eventId" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ReviewModeration" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "isApproved" BOOLEAN,
    "flagReason" TEXT,
    "aiScore" DOUBLE PRECISION,
    "aiReason" TEXT,
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewModeration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "oldData" JSONB,
    "newData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "NewsletterSubscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Donation" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "donorName" TEXT,
    "donorEmail" TEXT,
    "message" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- 6. NEW TABLES (E-COMMERCE)
CREATE TABLE IF NOT EXISTS "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "sku" TEXT,
    "imageUrl" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(10,2) NOT NULL,
    "platformFee" DECIMAL(10,2),
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT,
    "shippingAddress" TEXT,
    "shippingMethod" TEXT,
    "shippingCost" DECIMAL(10,2),
    "paymentMethod" TEXT,
    "paymentId" TEXT,
    "invoiceUrl" TEXT,
    "bankSlipUrl" TEXT,
    "pixQrCode" TEXT,
    "pixPayload" TEXT,
    "visitorId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrderItem" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL, -- PERCENT, FIXED
    "discountValue" DECIMAL(10,2) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- 7. NEW TABLES (GAMIFICATION ADVANCED)
CREATE TABLE IF NOT EXISTS "VisitorRPG" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "characterName" TEXT NOT NULL DEFAULT 'Explorador',
    "characterClass" TEXT NOT NULL DEFAULT 'NOVATO',
    "level" INTEGER NOT NULL DEFAULT 1,
    "currentXp" INTEGER NOT NULL DEFAULT 0,
    "nextLevelXp" INTEGER NOT NULL DEFAULT 100,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "totalWorks" INTEGER NOT NULL DEFAULT 0,
    "totalCards" INTEGER NOT NULL DEFAULT 0,
    "avatarUrl" TEXT,
    "selectedCharacterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VisitorRPG_pkey" PRIMARY KEY ("id")
);

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

CREATE TABLE IF NOT EXISTS "DailyChallenge" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 50,
    "type" TEXT NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 1,
    "conditions" JSONB,
    "activeDate" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DailyChallengeCompletion" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyChallengeCompletion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScavengerHunt" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "xpReward" INTEGER NOT NULL DEFAULT 200,
    "badgeReward" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScavengerHunt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScavengerHuntStep" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "clue" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "huntId" TEXT NOT NULL,
    "workId" TEXT,
    CONSTRAINT "ScavengerHuntStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ScavengerHuntParticipation" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "huntId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScavengerHuntParticipation_pkey" PRIMARY KEY ("id")
);

-- 8. NEW TABLES (ROADMAP 2026 - COMMUNITY & MUNICIPAL)
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

CREATE TABLE IF NOT EXISTS "TimelineEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "people" JSONB,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- Ticket & Registration
CREATE TABLE IF NOT EXISTS "Ticket" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TicketType" NOT NULL DEFAULT 'FREE',
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "quantity" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "absorbFee" BOOLEAN NOT NULL DEFAULT false,
    "minBuy" INTEGER NOT NULL DEFAULT 1,
    "maxBuy" INTEGER NOT NULL DEFAULT 5,
    "salesStartDate" TIMESTAMP(3),
    "salesEndDate" TIMESTAMP(3),
    "status" "TicketStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Registration" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "visitorId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "checkInDate" TIMESTAMP(3),
    "pricePaid" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "platformFee" DECIMAL(10,2),
    "asaasPaymentId" TEXT,
    "asaasPaymentStatus" TEXT,
    "customFormData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- Survey Questions
CREATE TABLE IF NOT EXISTS "SurveyQuestion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL DEFAULT 'STARS',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SurveyResponse" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "visitorId" TEXT,
    "guestEmail" TEXT,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyResponse_pkey" PRIMARY KEY ("id")
);

-- Final relation tables
CREATE TABLE IF NOT EXISTS "Building" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- 9. INDEXES & UNIQUE CONSTRAINTS
CREATE UNIQUE INDEX IF NOT EXISTS "AIUsage_tenantId_month_year_key" ON "AIUsage"("tenantId", "month", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "RefreshToken_token_key" ON "RefreshToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "VisitorRPG_visitorId_key" ON "VisitorRPG"("visitorId");
CREATE UNIQUE INDEX IF NOT EXISTS "VisitorSkin_visitorId_skinId_key" ON "VisitorSkin"("visitorId", "skinId");
CREATE UNIQUE INDEX IF NOT EXISTS "DailyChallengeCompletion_visitorId_challengeId_key" ON "DailyChallengeCompletion"("visitorId", "challengeId");
CREATE UNIQUE INDEX IF NOT EXISTS "ScavengerHuntParticipation_visitorId_huntId_key" ON "ScavengerHuntParticipation"("visitorId", "huntId");
CREATE UNIQUE INDEX IF NOT EXISTS "AccessibilityProvider_userId_key" ON "AccessibilityProvider"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_visitorId_workId_key" ON "Favorite"("visitorId", "workId");
CREATE UNIQUE INDEX IF NOT EXISTS "Review_visitorId_workId_key" ON "Review"("visitorId", "workId");
CREATE UNIQUE INDEX IF NOT EXISTS "Registration_code_key" ON "Registration"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_eventId_key" ON "Ticket"("eventId"); -- Optional, usually many tickets per event

-- 10. RE-MAP THE PREVIOUS MISSING CONVERSATION/MESSAGE TABLES
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

-- Extra models from schema
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

-- FOMO Models (Volunteer, Conservation, etc.)
CREATE TABLE IF NOT EXISTS "Volunteer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "skills" TEXT[],
    "availability" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Volunteer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VolunteerShift" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activity" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VolunteerShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConservationRecord" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "responsibleName" TEXT NOT NULL,
    "condition" TEXT,
    "notes" TEXT,
    "attachments" JSONB,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextScheduled" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConservationRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkLoan" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "borrowerContact" TEXT,
    "purpose" TEXT,
    "departureDate" TIMESTAMP(3) NOT NULL,
    "expectedReturn" TIMESTAMP(3),
    "actualReturn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "conditions" TEXT,
    "insuranceInfo" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkLoan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PPAGoal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metric" TEXT NOT NULL,
    "targetValue" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PPAGoal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CollectibleCard" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "workId" TEXT,
    "totalMinted" INTEGER NOT NULL DEFAULT 100,
    "xpReward" INTEGER NOT NULL DEFAULT 10,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectibleCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VisitorCard" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitorCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkTranslation" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "audioUrl" TEXT,
    "isAutoGenerated" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MuseumBattle" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "totalVisitors" INTEGER NOT NULL DEFAULT 0,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MuseumBattle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IntangibleHeritage" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "holders" TEXT,
    "region" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntangibleHeritage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SocialCheckin" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "message" TEXT,
    "emoji" TEXT DEFAULT '🏛️',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialCheckin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GroupTicket" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "totalTickets" INTEGER NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "eventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupTicket_pkey" PRIMARY KEY ("id")
);
