-- Reschedule Flow v2

ALTER TABLE "Club" ADD COLUMN "reschedulePolicyJson" TEXT;

ALTER TABLE "Booking" ADD COLUMN "rescheduleCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Hold" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'BOOKING';

CREATE INDEX "Hold_clubId_slotId_seatId_purpose_idx" ON "Hold"("clubId", "slotId", "seatId", "purpose");

CREATE TABLE "RescheduleIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "oldSlotId" TEXT,
  "oldSeatId" TEXT,
  "newSlotId" TEXT NOT NULL,
  "newSeatId" TEXT NOT NULL,
  "newRoomId" INTEGER,
  "packageId" TEXT,
  "lockHoldId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "expiresAtUtc" DATETIME NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdByRole" TEXT NOT NULL,
  "reason" TEXT,
  "policyOverrideUsed" BOOLEAN NOT NULL DEFAULT false,
  "oldPriceTotal" INTEGER NOT NULL,
  "newPriceTotal" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "requiredAction" TEXT NOT NULL DEFAULT 'NONE',
  "paymentStatus" TEXT NOT NULL DEFAULT 'NONE',
  "settlementStatus" TEXT NOT NULL DEFAULT 'NONE',
  "newQuoteSnapshotJson" TEXT NOT NULL,
  "confirmedAt" DATETIME,
  "canceledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RescheduleIntent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RescheduleIntent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RescheduleIntent_oldSlotId_fkey" FOREIGN KEY ("oldSlotId") REFERENCES "Slot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RescheduleIntent_newSlotId_fkey" FOREIGN KEY ("newSlotId") REFERENCES "Slot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RescheduleIntent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RescheduleIntent_lockHoldId_fkey" FOREIGN KEY ("lockHoldId") REFERENCES "Hold" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RescheduleIntent_lockHoldId_key" ON "RescheduleIntent"("lockHoldId");
CREATE INDEX "RescheduleIntent_clubId_bookingId_status_idx" ON "RescheduleIntent"("clubId", "bookingId", "status");
CREATE INDEX "RescheduleIntent_clubId_newSlotId_newSeatId_status_idx" ON "RescheduleIntent"("clubId", "newSlotId", "newSeatId", "status");
CREATE INDEX "RescheduleIntent_clubId_expiresAtUtc_status_idx" ON "RescheduleIntent"("clubId", "expiresAtUtc", "status");
CREATE INDEX "RescheduleIntent_createdByUserId_createdAt_idx" ON "RescheduleIntent"("createdByUserId", "createdAt");

CREATE TABLE "BookingEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bookingId" INTEGER NOT NULL,
  "clubId" TEXT,
  "eventType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "beforeJson" TEXT NOT NULL,
  "afterJson" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingEvent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BookingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");
CREATE INDEX "BookingEvent_clubId_createdAt_idx" ON "BookingEvent"("clubId", "createdAt");
CREATE INDEX "BookingEvent_eventType_createdAt_idx" ON "BookingEvent"("eventType", "createdAt");
