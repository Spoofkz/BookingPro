-- Platform Admin Console v2

CREATE TABLE "PlatformAdminUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlatformAdminUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PlatformAdminUser_userId_role_key" ON "PlatformAdminUser"("userId", "role");
CREATE INDEX "PlatformAdminUser_userId_status_idx" ON "PlatformAdminUser"("userId", "status");
CREATE INDEX "PlatformAdminUser_role_status_idx" ON "PlatformAdminUser"("role", "status");

CREATE TABLE "ClubVerification" (
  "clubId" TEXT NOT NULL PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "submittedAt" DATETIME,
  "reviewedAt" DATETIME,
  "reviewedByUserId" TEXT,
  "notes" TEXT,
  "documentsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClubVerification_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClubVerification_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ClubVerification_status_updatedAt_idx" ON "ClubVerification"("status", "updatedAt");
CREATE INDEX "ClubVerification_reviewedByUserId_reviewedAt_idx" ON "ClubVerification"("reviewedByUserId", "reviewedAt");

CREATE TABLE "Dispute" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT,
  "bookingId" INTEGER,
  "paymentId" INTEGER,
  "customerUserId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "subject" TEXT,
  "description" TEXT,
  "assignedToUserId" TEXT,
  "createdByUserId" TEXT,
  "resolutionSummary" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Dispute_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Dispute_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Dispute_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Dispute_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Dispute_status_updatedAt_idx" ON "Dispute"("status", "updatedAt");
CREATE INDEX "Dispute_type_status_updatedAt_idx" ON "Dispute"("type", "status", "updatedAt");
CREATE INDEX "Dispute_clubId_status_updatedAt_idx" ON "Dispute"("clubId", "status", "updatedAt");
CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");
CREATE INDEX "Dispute_paymentId_idx" ON "Dispute"("paymentId");
CREATE INDEX "Dispute_assignedToUserId_status_idx" ON "Dispute"("assignedToUserId", "status");
CREATE INDEX "Dispute_customerUserId_createdAt_idx" ON "Dispute"("customerUserId", "createdAt");

CREATE TABLE "PlatformNote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "clubId" TEXT,
  "text" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlatformNote_entityType_entityId_createdAt_idx" ON "PlatformNote"("entityType", "entityId", "createdAt");
CREATE INDEX "PlatformNote_clubId_createdAt_idx" ON "PlatformNote"("clubId", "createdAt");
CREATE INDEX "PlatformNote_createdByUserId_createdAt_idx" ON "PlatformNote"("createdByUserId", "createdAt");

-- Backfill demo platform roles if demo users already exist.
INSERT INTO "PlatformAdminUser" ("id", "userId", "role", "status", "notes", "createdAt", "updatedAt")
SELECT
  ('padm_' || lower(hex(randomblob(12)))),
  u."id",
  'PLATFORM_ADMIN',
  'ACTIVE',
  'Seeded demo platform admin',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE lower(COALESCE(u."email", '')) = 'tech@example.com'
  AND NOT EXISTS (
    SELECT 1
    FROM "PlatformAdminUser" p
    WHERE p."userId" = u."id"
      AND p."role" = 'PLATFORM_ADMIN'
  );

INSERT INTO "PlatformAdminUser" ("id", "userId", "role", "status", "notes", "createdAt", "updatedAt")
SELECT
  ('padm_' || lower(hex(randomblob(12)))),
  u."id",
  'PLATFORM_SUPPORT',
  'ACTIVE',
  'Seeded demo platform support',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE lower(COALESCE(u."email", '')) = 'azamat@example.com'
  AND NOT EXISTS (
    SELECT 1
    FROM "PlatformAdminUser" p
    WHERE p."userId" = u."id"
      AND p."role" = 'PLATFORM_SUPPORT'
  );
