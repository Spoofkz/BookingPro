-- Customer Management (Light CRM) v2

ALTER TABLE "Booking" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "guestPhone" TEXT;

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "linkedUserId" TEXT,
  "displayName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Customer_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Customer_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Customer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CustomerNote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CustomerNote_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CustomerTag" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTag_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerTag_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerTag_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Customer_clubId_phone_key" ON "Customer"("clubId", "phone");
CREATE INDEX "Customer_clubId_phone_idx" ON "Customer"("clubId", "phone");
CREATE INDEX "Customer_clubId_displayName_idx" ON "Customer"("clubId", "displayName");
CREATE INDEX "Customer_clubId_email_idx" ON "Customer"("clubId", "email");
CREATE INDEX "Customer_clubId_status_idx" ON "Customer"("clubId", "status");

CREATE INDEX "CustomerNote_clubId_customerId_createdAt_idx" ON "CustomerNote"("clubId", "customerId", "createdAt");

CREATE UNIQUE INDEX "CustomerTag_clubId_customerId_tag_key" ON "CustomerTag"("clubId", "customerId", "tag");
CREATE INDEX "CustomerTag_clubId_tag_idx" ON "CustomerTag"("clubId", "tag");
CREATE INDEX "CustomerTag_clubId_customerId_idx" ON "CustomerTag"("clubId", "customerId");

CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");
CREATE INDEX "Booking_guestPhone_idx" ON "Booking"("guestPhone");
CREATE INDEX "Booking_clubId_customerId_idx" ON "Booking"("clubId", "customerId");
