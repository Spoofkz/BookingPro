-- Memberships / Subscriptions v2

ALTER TABLE "Booking" ADD COLUMN "membershipConsumptionJson" TEXT;
ALTER TABLE "Booking" ADD COLUMN "membershipReversedAt" DATETIME;

CREATE TABLE "MembershipPlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceAmount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "valueAmount" INTEGER NOT NULL,
  "billingPeriod" TEXT,
  "eligibilityJson" TEXT,
  "timeRestrictionsJson" TEXT,
  "expiryPolicyJson" TEXT,
  "isClientVisible" BOOLEAN NOT NULL DEFAULT true,
  "isHostVisible" BOOLEAN NOT NULL DEFAULT true,
  "allowStacking" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MembershipPlan_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipPlan_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipPlan_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MembershipPlan_clubId_status_idx" ON "MembershipPlan"("clubId", "status");
CREATE INDEX "MembershipPlan_clubId_type_status_idx" ON "MembershipPlan"("clubId", "type", "status");
CREATE INDEX "MembershipPlan_clubId_isClientVisible_status_idx" ON "MembershipPlan"("clubId", "isClientVisible", "status");
CREATE INDEX "MembershipPlan_clubId_name_idx" ON "MembershipPlan"("clubId", "name");

CREATE TABLE "MembershipEntitlement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "customerId" TEXT,
  "userId" TEXT,
  "planId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "remainingMinutes" INTEGER,
  "remainingSessions" INTEGER,
  "walletBalance" INTEGER,
  "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" DATETIME,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false,
  "periodStart" DATETIME,
  "periodEnd" DATETIME,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MembershipEntitlement_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipEntitlement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MembershipEntitlement_clubId_userId_status_idx" ON "MembershipEntitlement"("clubId", "userId", "status");
CREATE INDEX "MembershipEntitlement_clubId_customerId_status_idx" ON "MembershipEntitlement"("clubId", "customerId", "status");
CREATE INDEX "MembershipEntitlement_clubId_type_status_idx" ON "MembershipEntitlement"("clubId", "type", "status");
CREATE INDEX "MembershipEntitlement_validTo_idx" ON "MembershipEntitlement"("validTo");

CREATE TABLE "MembershipTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clubId" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "planId" TEXT,
  "customerId" TEXT,
  "userId" TEXT,
  "bookingId" INTEGER,
  "paymentId" INTEGER,
  "txType" TEXT NOT NULL,
  "amountDelta" INTEGER NOT NULL DEFAULT 0,
  "minutesDelta" INTEGER NOT NULL DEFAULT 0,
  "sessionsDelta" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdByRole" TEXT,
  "reason" TEXT,
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipTransaction_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "MembershipEntitlement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MembershipTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "MembershipTransaction_clubId_txType_createdAt_idx" ON "MembershipTransaction"("clubId", "txType", "createdAt");
CREATE INDEX "MembershipTransaction_entitlementId_createdAt_idx" ON "MembershipTransaction"("entitlementId", "createdAt");
CREATE INDEX "MembershipTransaction_customerId_createdAt_idx" ON "MembershipTransaction"("customerId", "createdAt");
CREATE INDEX "MembershipTransaction_userId_createdAt_idx" ON "MembershipTransaction"("userId", "createdAt");
CREATE INDEX "MembershipTransaction_bookingId_txType_idx" ON "MembershipTransaction"("bookingId", "txType");
