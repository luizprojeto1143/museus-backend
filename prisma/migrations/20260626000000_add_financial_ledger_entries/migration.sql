-- 1. Alter StripeWebhookEvent
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='StripeWebhookEvent' AND column_name='processedAt') THEN
        ALTER TABLE "StripeWebhookEvent" DROP COLUMN "processedAt";
    END IF;
END $$;

ALTER TABLE "StripeWebhookEvent" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "StripeWebhookEvent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "StripeWebhookEvent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "StripeWebhookEvent" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

-- 2. Alter Refund
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "retries" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Refund_transactionId_fkey') THEN
        ALTER TABLE "Refund" ADD CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Alter PayoutLedger
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "recipientType" TEXT NOT NULL DEFAULT 'MUSEUM';
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "recipientId" TEXT NOT NULL DEFAULT '';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='PayoutLedger' AND column_name='tenantId') THEN
        UPDATE "PayoutLedger" SET "recipientId" = "tenantId" WHERE "recipientId" = '';
    END IF;
END $$;

ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "sourceTransactionId" TEXT;
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "grossAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='PayoutLedger' AND column_name='amount') THEN
        UPDATE "PayoutLedger" SET "grossAmount" = "amount" WHERE "grossAmount" = 0.00;
    END IF;
END $$;

ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "gatewayFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "stripeTransferId" TEXT;
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "bankAccountLast4" TEXT;
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3);
ALTER TABLE "PayoutLedger" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3);
ALTER TABLE "PayoutLedger" ALTER COLUMN "stripePayoutId" DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'PayoutLedger_stripeTransferId_key') THEN
        CREATE UNIQUE INDEX "PayoutLedger_stripeTransferId_key" ON "PayoutLedger"("stripeTransferId");
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='PayoutLedger' AND column_name='amount') THEN
        ALTER TABLE "PayoutLedger" DROP COLUMN "amount";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='PayoutLedger' AND column_name='fee') THEN
        ALTER TABLE "PayoutLedger" DROP COLUMN "fee";
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='PayoutLedger' AND column_name='arrivalDate') THEN
        ALTER TABLE "PayoutLedger" DROP COLUMN "arrivalDate";
    END IF;
END $$;

-- 4. Create FinancialLedgerEntry table
CREATE TABLE IF NOT EXISTS "FinancialLedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "gatewayFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" TEXT NOT NULL,
    "paymentProvider" TEXT NOT NULL DEFAULT 'STRIPE',
    "paymentMethod" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeRefundId" TEXT,
    "payoutId" TEXT,
    "idempotencyKey" TEXT,
    "competenceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlementDate" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'FinancialLedgerEntry_idempotencyKey_key') THEN
        CREATE UNIQUE INDEX "FinancialLedgerEntry_idempotencyKey_key" ON "FinancialLedgerEntry"("idempotencyKey");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'FinancialLedgerEntry_tenantId_idx') THEN
        CREATE INDEX "FinancialLedgerEntry_tenantId_idx" ON "FinancialLedgerEntry"("tenantId");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'FinancialLedgerEntry_sourceType_sourceId_idx') THEN
        CREATE INDEX "FinancialLedgerEntry_sourceType_sourceId_idx" ON "FinancialLedgerEntry"("sourceType", "sourceId");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'FinancialLedgerEntry_tenantId_fkey') THEN
        ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "FinancialLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
