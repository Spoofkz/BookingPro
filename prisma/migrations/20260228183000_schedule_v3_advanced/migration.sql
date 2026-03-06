ALTER TABLE "ScheduleTemplate" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Default schedule';
ALTER TABLE "ScheduleTemplate" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "ScheduleTemplate" ADD COLUMN "defaultHorizonDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ScheduleTemplate" ADD COLUMN "slotStepMinutes" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "ScheduleTemplate" ADD COLUMN "breakBufferMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduleTemplate" ADD COLUMN "fixedStartsOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ScheduleException" ADD COLUMN "title" TEXT;
ALTER TABLE "ScheduleException" ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'CLUB';
ALTER TABLE "ScheduleException" ADD COLUMN "scopeRefId" TEXT;
ALTER TABLE "ScheduleException" ADD COLUMN "behavior" TEXT;
ALTER TABLE "ScheduleException" ADD COLUMN "isEvent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduleException" ADD COLUMN "deletedAt" DATETIME;

CREATE TABLE "SchedulePlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT_GENERATED',
    "fromLocalDate" TEXT NOT NULL,
    "toLocalDate" TEXT NOT NULL,
    "rangeStartUtc" DATETIME NOT NULL,
    "rangeEndUtc" DATETIME NOT NULL,
    "diffSummaryJson" TEXT NOT NULL,
    "conflictsJson" TEXT NOT NULL,
    "slotsJson" TEXT NOT NULL,
    "generatedByUserId" TEXT,
    "publishedByUserId" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SchedulePlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SchedulePlan_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SchedulePlan_clubId_status_generatedAt_idx" ON "SchedulePlan"("clubId", "status", "generatedAt");
CREATE INDEX "SchedulePlan_clubId_rangeStartUtc_rangeEndUtc_idx" ON "SchedulePlan"("clubId", "rangeStartUtc", "rangeEndUtc");
CREATE INDEX "SchedulePlan_templateId_generatedAt_idx" ON "SchedulePlan"("templateId", "generatedAt");
CREATE INDEX "ScheduleException_clubId_deletedAt_startAt_endAt_idx" ON "ScheduleException"("clubId", "deletedAt", "startAt", "endAt");
CREATE INDEX "ScheduleException_clubId_type_startAt_deletedAt_idx" ON "ScheduleException"("clubId", "type", "startAt", "deletedAt");
