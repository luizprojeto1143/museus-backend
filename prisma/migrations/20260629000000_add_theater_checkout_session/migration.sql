-- AlterTable
ALTER TABLE "TheaterSeatReservation" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT;
ALTER TABLE "TheaterSeatReservation" ADD COLUMN IF NOT EXISTS "reservationGroupId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TheaterSeatReservationGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "stripeCheckoutSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheaterSeatReservationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TheaterSeatReservationGroup_stripeCheckoutSessionId_key" ON "TheaterSeatReservationGroup"("stripeCheckoutSessionId");
CREATE INDEX IF NOT EXISTS "TheaterSeatReservationGroup_eventId_idx" ON "TheaterSeatReservationGroup"("eventId");
CREATE INDEX IF NOT EXISTS "TheaterSeatReservationGroup_tenantId_idx" ON "TheaterSeatReservationGroup"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TheaterSeatReservation_stripeCheckoutSessionId_idx" ON "TheaterSeatReservation"("stripeCheckoutSessionId");
CREATE INDEX IF NOT EXISTS "TheaterSeatReservation_reservationGroupId_idx" ON "TheaterSeatReservation"("reservationGroupId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'TheaterSeatReservation_reservationGroupId_fkey') THEN
        ALTER TABLE "TheaterSeatReservation" ADD CONSTRAINT "TheaterSeatReservation_reservationGroupId_fkey" FOREIGN KEY ("reservationGroupId") REFERENCES "TheaterSeatReservationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'TheaterSeatReservationGroup_eventId_fkey') THEN
        ALTER TABLE "TheaterSeatReservationGroup" ADD CONSTRAINT "TheaterSeatReservationGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
