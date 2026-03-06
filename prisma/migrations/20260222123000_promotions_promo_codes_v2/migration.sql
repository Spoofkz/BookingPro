ALTER TABLE "Promotion" ADD COLUMN "name" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "descriptionPublic" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "constraintsJson" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "usageJson" TEXT;

CREATE TABLE "PromoRedemption" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "promoId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "bookingId" INTEGER NOT NULL,
  "userId" TEXT,
  "customerId" TEXT,
  "discountAmountCents" INTEGER NOT NULL,
  "promoCodeSnapshot" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PromoRedemption_bookingId_key" ON "PromoRedemption"("bookingId");
CREATE INDEX "PromoRedemption_promoId_createdAt_idx" ON "PromoRedemption"("promoId", "createdAt");
CREATE INDEX "PromoRedemption_clubId_createdAt_idx" ON "PromoRedemption"("clubId", "createdAt");
CREATE INDEX "PromoRedemption_promoId_userId_createdAt_idx" ON "PromoRedemption"("promoId", "userId", "createdAt");
CREATE INDEX "PromoRedemption_promoId_customerId_createdAt_idx" ON "PromoRedemption"("promoId", "customerId", "createdAt");
