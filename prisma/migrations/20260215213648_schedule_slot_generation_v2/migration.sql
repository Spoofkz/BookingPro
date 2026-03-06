-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "slotDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "weeklyHoursJson" TEXT NOT NULL,
    "bookingLeadTimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "effectiveFrom" DATETIME,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleTemplate_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleException_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleException_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "startAtUtc" DATETIME NOT NULL,
    "endAtUtc" DATETIME NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "generatedFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Slot_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clubId" TEXT,
    "slotId" TEXT,
    "seatId" TEXT,
    "roomId" INTEGER NOT NULL,
    "clientUserId" TEXT,
    "packageId" TEXT,
    "pricingVersionId" TEXT,
    "quoteId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "checkIn" DATETIME NOT NULL,
    "checkOut" DATETIME NOT NULL,
    "guests" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'ONLINE',
    "customerType" TEXT NOT NULL DEFAULT 'GUEST',
    "promoCode" TEXT,
    "priceTotalCents" INTEGER,
    "priceCurrency" TEXT,
    "priceSnapshotJson" TEXT,
    "packageSnapshotJson" TEXT,
    "checkedInAt" DATETIME,
    "checkedOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PricingPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PriceQuote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("channel", "checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "customerType", "guestEmail", "guestName", "guests", "id", "notes", "packageId", "packageSnapshotJson", "paymentStatus", "priceCurrency", "priceSnapshotJson", "priceTotalCents", "pricingVersionId", "promoCode", "quoteId", "roomId", "seatId", "slotId", "status", "updatedAt") SELECT "channel", "checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "customerType", "guestEmail", "guestName", "guests", "id", "notes", "packageId", "packageSnapshotJson", "paymentStatus", "priceCurrency", "priceSnapshotJson", "priceTotalCents", "pricingVersionId", "promoCode", "quoteId", "roomId", "seatId", "slotId", "status", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE INDEX "Booking_clubId_idx" ON "Booking"("clubId");
CREATE INDEX "Booking_clientUserId_idx" ON "Booking"("clientUserId");
CREATE INDEX "Booking_packageId_idx" ON "Booking"("packageId");
CREATE INDEX "Booking_pricingVersionId_idx" ON "Booking"("pricingVersionId");
CREATE INDEX "Booking_quoteId_idx" ON "Booking"("quoteId");
CREATE INDEX "Booking_roomId_checkIn_checkOut_idx" ON "Booking"("roomId", "checkIn", "checkOut");
CREATE INDEX "Booking_guestEmail_idx" ON "Booking"("guestEmail");
CREATE INDEX "Booking_status_idx" ON "Booking"("status");
CREATE INDEX "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");
CREATE INDEX "Booking_clubId_slotId_seatId_status_idx" ON "Booking"("clubId", "slotId", "seatId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleTemplate_clubId_key" ON "ScheduleTemplate"("clubId");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_clubId_updatedAt_idx" ON "ScheduleTemplate"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "ScheduleException_clubId_startAt_endAt_idx" ON "ScheduleException"("clubId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "ScheduleException_clubId_type_startAt_idx" ON "ScheduleException"("clubId", "type", "startAt");

-- CreateIndex
CREATE INDEX "Slot_clubId_localDate_idx" ON "Slot"("clubId", "localDate");

-- CreateIndex
CREATE INDEX "Slot_clubId_startAtUtc_idx" ON "Slot"("clubId", "startAtUtc");

-- CreateIndex
CREATE INDEX "Slot_clubId_status_startAtUtc_idx" ON "Slot"("clubId", "status", "startAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_clubId_startAtUtc_endAtUtc_key" ON "Slot"("clubId", "startAtUtc", "endAtUtc");

