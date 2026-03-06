ALTER TABLE "PricingVersion"
ADD COLUMN "effectiveTo" DATETIME;

CREATE INDEX "PricingVersion_clubId_status_effectiveTo_idx"
ON "PricingVersion"("clubId", "status", "effectiveTo");
