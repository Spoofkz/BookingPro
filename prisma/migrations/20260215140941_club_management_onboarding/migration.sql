-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "description" TEXT,
    "contactsJson" TEXT,
    "geoLat" REAL,
    "geoLng" REAL,
    "businessHoursText" TEXT,
    "logoUrl" TEXT,
    "galleryJson" TEXT,
    "holdTtlMinutes" INTEGER,
    "cancellationPolicyJson" TEXT,
    "checkInPolicyJson" TEXT,
    "schedulePublishedAt" DATETIME,
    "slotsGeneratedUntil" DATETIME,
    "pauseReason" TEXT,
    "pauseUntil" DATETIME,
    "publishedAt" DATETIME,
    "rounding" TEXT NOT NULL DEFAULT 'ROUND_TO_10',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Club" ("address", "createdAt", "currency", "id", "name", "rounding", "slug", "status", "updatedAt") SELECT "address", "createdAt", "currency", "id", "name", "rounding", "slug", "status", "updatedAt" FROM "Club";
DROP TABLE "Club";
ALTER TABLE "new_Club" RENAME TO "Club";
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");
CREATE INDEX "Club_name_idx" ON "Club"("name");
CREATE INDEX "Club_status_idx" ON "Club"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
