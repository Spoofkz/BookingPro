-- PRD v3 Milestone #15: customer risk/attention state
ALTER TABLE "Customer" ADD COLUMN "isBlocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "blockedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "blockedByUserId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "requiresAttention" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "attentionReason" TEXT;

CREATE INDEX "Customer_clubId_isBlocked_idx" ON "Customer"("clubId", "isBlocked");
CREATE INDEX "Customer_clubId_requiresAttention_idx" ON "Customer"("clubId", "requiresAttention");
