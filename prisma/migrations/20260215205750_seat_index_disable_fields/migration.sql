-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SeatIndex" (
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
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("seatId", "mapVersionId"),
    CONSTRAINT "SeatIndex_mapVersionId_fkey" FOREIGN KEY ("mapVersionId") REFERENCES "SeatMapVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatIndex_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SeatIndex" ("clubId", "createdAt", "floorId", "geometryJson", "isActive", "label", "mapVersionId", "roomId", "seatId", "seatType", "segmentId", "updatedAt") SELECT "clubId", "createdAt", "floorId", "geometryJson", "isActive", "label", "mapVersionId", "roomId", "seatId", "seatType", "segmentId", "updatedAt" FROM "SeatIndex";
DROP TABLE "SeatIndex";
ALTER TABLE "new_SeatIndex" RENAME TO "SeatIndex";
CREATE INDEX "SeatIndex_clubId_mapVersionId_idx" ON "SeatIndex"("clubId", "mapVersionId");
CREATE INDEX "SeatIndex_clubId_floorId_idx" ON "SeatIndex"("clubId", "floorId");
CREATE INDEX "SeatIndex_clubId_roomId_idx" ON "SeatIndex"("clubId", "roomId");
CREATE INDEX "SeatIndex_clubId_segmentId_idx" ON "SeatIndex"("clubId", "segmentId");
CREATE INDEX "SeatIndex_clubId_seatId_idx" ON "SeatIndex"("clubId", "seatId");
CREATE UNIQUE INDEX "SeatIndex_mapVersionId_label_key" ON "SeatIndex"("mapVersionId", "label");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

