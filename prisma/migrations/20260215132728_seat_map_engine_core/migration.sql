-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "seatId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "slotId" TEXT;

-- CreateTable
CREATE TABLE "SeatMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeatMap_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatMap_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeatMapVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mapId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "publishedJson" TEXT NOT NULL,
    "seatCount" INTEGER NOT NULL DEFAULT 0,
    "publishedByUserId" TEXT,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeatMapVersion_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "SeatMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatMapVersion_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatMapVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeatIndex" (
    "seatId" TEXT NOT NULL,
    "mapVersionId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "roomId" TEXT,
    "segmentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seatType" TEXT NOT NULL DEFAULT 'PC',
    "geometryJson" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("seatId", "mapVersionId"),
    CONSTRAINT "SeatIndex_mapVersionId_fkey" FOREIGN KEY ("mapVersionId") REFERENCES "SeatMapVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatIndex_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FloorAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "floorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FloorAsset_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "SeatMap" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FloorAsset_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SeatMap_clubId_key" ON "SeatMap"("clubId");

-- CreateIndex
CREATE INDEX "SeatMap_clubId_updatedAt_idx" ON "SeatMap"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "SeatMapVersion_clubId_publishedAt_idx" ON "SeatMapVersion"("clubId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeatMapVersion_mapId_versionNumber_key" ON "SeatMapVersion"("mapId", "versionNumber");

-- CreateIndex
CREATE INDEX "SeatIndex_clubId_mapVersionId_idx" ON "SeatIndex"("clubId", "mapVersionId");

-- CreateIndex
CREATE INDEX "SeatIndex_clubId_floorId_idx" ON "SeatIndex"("clubId", "floorId");

-- CreateIndex
CREATE INDEX "SeatIndex_clubId_roomId_idx" ON "SeatIndex"("clubId", "roomId");

-- CreateIndex
CREATE INDEX "SeatIndex_clubId_segmentId_idx" ON "SeatIndex"("clubId", "segmentId");

-- CreateIndex
CREATE INDEX "SeatIndex_clubId_seatId_idx" ON "SeatIndex"("clubId", "seatId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatIndex_mapVersionId_label_key" ON "SeatIndex"("mapVersionId", "label");

-- CreateIndex
CREATE INDEX "FloorAsset_clubId_mapId_floorId_idx" ON "FloorAsset"("clubId", "mapId", "floorId");

-- CreateIndex
CREATE INDEX "Booking_clubId_slotId_seatId_status_idx" ON "Booking"("clubId", "slotId", "seatId", "status");
