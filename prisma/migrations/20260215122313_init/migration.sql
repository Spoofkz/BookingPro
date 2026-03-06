-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Segment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "pricingType" TEXT NOT NULL,
    "fixedPriceCents" INTEGER,
    "discountPercent" REAL,
    "ratePerHourCents" INTEGER,
    "visibleToClients" BOOLEAN NOT NULL DEFAULT true,
    "visibleToHosts" BOOLEAN NOT NULL DEFAULT true,
    "daysOfWeekCsv" TEXT,
    "timeWindowStartMinute" INTEGER,
    "timeWindowEndMinute" INTEGER,
    "applyTimeModifiers" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingPackage_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackageSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageSegment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PricingPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageSegment_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackageRoom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "roomId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageRoom_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PricingPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "publishedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingVersion_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PricingVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pricingVersionId" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "dayOfWeekCsv" TEXT,
    "timeWindowStartMinute" INTEGER,
    "timeWindowEndMinute" INTEGER,
    "channel" TEXT,
    "customerType" TEXT,
    "setRatePerHourCents" INTEGER,
    "addPercent" REAL,
    "addFixedAmountCents" INTEGER,
    "addFixedMode" TEXT,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingRule_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL,
    "activeFrom" DATETIME NOT NULL,
    "activeTo" DATETIME NOT NULL,
    "percentOff" REAL,
    "fixedOffCents" INTEGER,
    "minTotalCents" INTEGER,
    "maxUsesTotal" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "applicableSegmentIdsCsv" TEXT,
    "applicablePackageIdsCsv" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Promotion_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "pricingVersionId" TEXT,
    "promotionId" TEXT,
    "requestHash" TEXT,
    "contextJson" TEXT NOT NULL,
    "breakdownJson" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceQuote_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceQuote_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PriceQuote_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clubId" TEXT,
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
    CONSTRAINT "Booking_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PricingPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PriceQuote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "guestEmail", "guestName", "guests", "id", "notes", "paymentStatus", "roomId", "status", "updatedAt") SELECT "checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "guestEmail", "guestName", "guests", "id", "notes", "paymentStatus", "roomId", "status", "updatedAt" FROM "Booking";
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
CREATE TABLE "new_Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "rounding" TEXT NOT NULL DEFAULT 'ROUND_TO_10',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Club" ("address", "createdAt", "id", "name", "slug", "status", "updatedAt") SELECT "address", "createdAt", "id", "name", "slug", "status", "updatedAt" FROM "Club";
DROP TABLE "Club";
ALTER TABLE "new_Club" RENAME TO "Club";
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
CREATE INDEX "Club_name_idx" ON "Club"("name");
CREATE TABLE "new_Room" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clubId" TEXT,
    "segmentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "pricePerNightCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Room_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("capacity", "clubId", "createdAt", "id", "name", "pricePerNightCents", "slug", "updatedAt") SELECT "capacity", "clubId", "createdAt", "id", "name", "pricePerNightCents", "slug", "updatedAt" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_slug_key" ON "Room"("slug");
CREATE INDEX "Room_clubId_idx" ON "Room"("clubId");
CREATE INDEX "Room_segmentId_idx" ON "Room"("segmentId");
CREATE INDEX "Room_name_idx" ON "Room"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Segment_clubId_isActive_idx" ON "Segment"("clubId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_clubId_name_key" ON "Segment"("clubId", "name");

-- CreateIndex
CREATE INDEX "PricingPackage_clubId_isActive_idx" ON "PricingPackage"("clubId", "isActive");

-- CreateIndex
CREATE INDEX "PricingPackage_clubId_pricingType_idx" ON "PricingPackage"("clubId", "pricingType");

-- CreateIndex
CREATE INDEX "PackageSegment_segmentId_idx" ON "PackageSegment"("segmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageSegment_packageId_segmentId_key" ON "PackageSegment"("packageId", "segmentId");

-- CreateIndex
CREATE INDEX "PackageRoom_roomId_idx" ON "PackageRoom"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageRoom_packageId_roomId_key" ON "PackageRoom"("packageId", "roomId");

-- CreateIndex
CREATE INDEX "PricingVersion_clubId_status_effectiveFrom_idx" ON "PricingVersion"("clubId", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PricingVersion_clubId_versionNumber_key" ON "PricingVersion"("clubId", "versionNumber");

-- CreateIndex
CREATE INDEX "PricingRule_pricingVersionId_ruleType_priority_idx" ON "PricingRule"("pricingVersionId", "ruleType", "priority");

-- CreateIndex
CREATE INDEX "PricingRule_scopeType_scopeId_idx" ON "PricingRule"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "Promotion_clubId_isActive_activeFrom_activeTo_idx" ON "Promotion"("clubId", "isActive", "activeFrom", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_clubId_code_key" ON "Promotion"("clubId", "code");

-- CreateIndex
CREATE INDEX "PriceQuote_clubId_createdAt_idx" ON "PriceQuote"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "PriceQuote_requestHash_idx" ON "PriceQuote"("requestHash");
