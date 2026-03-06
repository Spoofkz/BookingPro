-- CreateTable
CREATE TABLE "Hold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAtUtc" DATETIME NOT NULL,
    "canceledAtUtc" DATETIME,
    "canceledByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hold_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hold_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hold_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Hold_canceledByUserId_fkey" FOREIGN KEY ("canceledByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Hold_clubId_slotId_idx" ON "Hold"("clubId", "slotId");

-- CreateIndex
CREATE INDEX "Hold_clubId_slotId_seatId_idx" ON "Hold"("clubId", "slotId", "seatId");

-- CreateIndex
CREATE INDEX "Hold_clubId_status_expiresAtUtc_idx" ON "Hold"("clubId", "status", "expiresAtUtc");
