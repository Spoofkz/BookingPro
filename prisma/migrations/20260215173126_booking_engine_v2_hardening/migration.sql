-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Booking" ADD COLUMN "canceledAt" DATETIME;
ALTER TABLE "Booking" ADD COLUMN "canceledByUserId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "checkedInByUserId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "seatLabelSnapshot" TEXT;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Hold_active_slot_seat_unique"
ON "Hold"("clubId", "slotId", "seatId")
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Booking_active_slot_seat_unique"
ON "Booking"("clubId", "slotId", "seatId")
WHERE "clubId" IS NOT NULL
  AND "slotId" IS NOT NULL
  AND "seatId" IS NOT NULL
  AND "status" IN ('CONFIRMED', 'CHECKED_IN');
