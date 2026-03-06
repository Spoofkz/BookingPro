ALTER TABLE "Club"
ADD COLUMN "city" TEXT;

ALTER TABLE "Club"
ADD COLUMN "area" TEXT;

ALTER TABLE "Club"
ADD COLUMN "amenitiesJson" TEXT;

ALTER TABLE "Club"
ADD COLUMN "startingFromAmount" INTEGER;

ALTER TABLE "Club"
ADD COLUMN "startingFromSegment" TEXT;

CREATE TABLE "ClubFeatured" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "featuredRank" INTEGER NOT NULL DEFAULT 100,
  "badgeText" TEXT,
  "featuredStartAt" DATETIME NOT NULL,
  "featuredEndAt" DATETIME NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ClubFeatured_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Club_city_area_idx"
ON "Club"("city", "area");

CREATE INDEX "Club_startingFromAmount_idx"
ON "Club"("startingFromAmount");

CREATE INDEX "ClubFeatured_clubId_isActive_featuredStartAt_featuredEndAt_idx"
ON "ClubFeatured"("clubId", "isActive", "featuredStartAt", "featuredEndAt");

CREATE INDEX "ClubFeatured_featuredRank_featuredStartAt_idx"
ON "ClubFeatured"("featuredRank", "featuredStartAt");
