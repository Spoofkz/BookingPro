-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'CLIENT',
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshotJson" TEXT,
    "expiresAt" DATETIME,
    "completedAt" DATETIME,
    "canceledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "holdId" TEXT,
    "slotId" TEXT,
    "seatId" TEXT,
    "seatLabelSnapshot" TEXT,
    "roomId" INTEGER,
    "segmentId" TEXT,
    "startAtUtc" DATETIME,
    "endAtUtc" DATETIME,
    "type" TEXT NOT NULL DEFAULT 'SEAT_BOOKING',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "totalPriceCents" INTEGER NOT NULL DEFAULT 0,
    "priceSnapshotJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "Hold" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "payloadJson" TEXT,
    "expiresAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentIntent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentIntent_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "discountTotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxTotalCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clubId" TEXT,
    "slotId" TEXT,
    "seatId" TEXT,
    "seatLabelSnapshot" TEXT,
    "customerId" TEXT,
    "roomId" INTEGER NOT NULL,
    "clientUserId" TEXT,
    "createdByUserId" TEXT,
    "checkedInByUserId" TEXT,
    "canceledByUserId" TEXT,
    "packageId" TEXT,
    "pricingVersionId" TEXT,
    "quoteId" TEXT,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "invoiceId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestPhone" TEXT,
    "checkIn" DATETIME NOT NULL,
    "checkOut" DATETIME NOT NULL,
    "guests" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'ONLINE',
    "customerType" TEXT NOT NULL DEFAULT 'GUEST',
    "promoCode" TEXT,
    "priceTotalCents" INTEGER,
    "priceCurrency" TEXT,
    "priceSnapshotJson" TEXT,
    "packageSnapshotJson" TEXT,
    "membershipConsumptionJson" TEXT,
    "membershipReversedAt" DATETIME,
    "checkedInAt" DATETIME,
    "checkedOutAt" DATETIME,
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PricingPackage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "PricingVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PriceQuote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("channel", "checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "customerId", "customerType", "guestEmail", "guestName", "guestPhone", "guests", "id", "membershipConsumptionJson", "membershipReversedAt", "notes", "packageId", "packageSnapshotJson", "paymentStatus", "priceCurrency", "priceSnapshotJson", "priceTotalCents", "pricingVersionId", "promoCode", "quoteId", "rescheduleCount", "roomId", "seatId", "slotId", "status", "updatedAt") SELECT "channel", "checkIn", "checkOut", "checkedInAt", "checkedOutAt", "clientUserId", "clubId", "createdAt", "customerId", "customerType", "guestEmail", "guestName", "guestPhone", "guests", "id", "membershipConsumptionJson", "membershipReversedAt", "notes", "packageId", "packageSnapshotJson", "paymentStatus", "priceCurrency", "priceSnapshotJson", "priceTotalCents", "pricingVersionId", "promoCode", "quoteId", "rescheduleCount", "roomId", "seatId", "slotId", "status", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_orderItemId_key" ON "Booking"("orderItemId");
CREATE INDEX "Booking_clubId_idx" ON "Booking"("clubId");
CREATE INDEX "Booking_clientUserId_idx" ON "Booking"("clientUserId");
CREATE INDEX "Booking_packageId_idx" ON "Booking"("packageId");
CREATE INDEX "Booking_pricingVersionId_idx" ON "Booking"("pricingVersionId");
CREATE INDEX "Booking_quoteId_idx" ON "Booking"("quoteId");
CREATE INDEX "Booking_roomId_checkIn_checkOut_idx" ON "Booking"("roomId", "checkIn", "checkOut");
CREATE INDEX "Booking_guestEmail_idx" ON "Booking"("guestEmail");
CREATE INDEX "Booking_status_idx" ON "Booking"("status");
CREATE INDEX "Booking_paymentStatus_idx" ON "Booking"("paymentStatus");
CREATE INDEX "Booking_clubId_slotId_seatId_status_idx" ON "Booking"("clubId", "slotId", "seatId", "status");
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");
CREATE INDEX "Booking_guestPhone_idx" ON "Booking"("guestPhone");
CREATE INDEX "Booking_clubId_customerId_idx" ON "Booking"("clubId", "customerId");
CREATE INDEX "Booking_orderId_idx" ON "Booking"("orderId");
CREATE INDEX "Booking_orderItemId_idx" ON "Booking"("orderItemId");
CREATE INDEX "Booking_invoiceId_idx" ON "Booking"("invoiceId");
CREATE TABLE "new_Hold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clubId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "orderId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'BOOKING',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAtUtc" DATETIME NOT NULL,
    "canceledAtUtc" DATETIME,
    "canceledByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hold_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hold_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Hold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Hold_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Hold_canceledByUserId_fkey" FOREIGN KEY ("canceledByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Hold" ("canceledAtUtc", "canceledByUserId", "clubId", "createdAt", "expiresAtUtc", "id", "ownerUserId", "purpose", "seatId", "slotId", "status", "updatedAt") SELECT "canceledAtUtc", "canceledByUserId", "clubId", "createdAt", "expiresAtUtc", "id", "ownerUserId", "purpose", "seatId", "slotId", "status", "updatedAt" FROM "Hold";
DROP TABLE "Hold";
ALTER TABLE "new_Hold" RENAME TO "Hold";
CREATE INDEX "Hold_clubId_slotId_idx" ON "Hold"("clubId", "slotId");
CREATE INDEX "Hold_clubId_slotId_seatId_idx" ON "Hold"("clubId", "slotId", "seatId");
CREATE INDEX "Hold_clubId_slotId_seatId_purpose_idx" ON "Hold"("clubId", "slotId", "seatId", "purpose");
CREATE INDEX "Hold_clubId_status_expiresAtUtc_idx" ON "Hold"("clubId", "status", "expiresAtUtc");
CREATE INDEX "Hold_orderId_idx" ON "Hold"("orderId");
CREATE TABLE "new_Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clubId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "orderId" TEXT,
    "intentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "providerRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "markedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Payment_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Payment" ("amountCents", "bookingId", "clubId", "createdAt", "id", "markedByUserId", "method", "providerRef", "status", "updatedAt") SELECT "amountCents", "bookingId", "clubId", "createdAt", "id", "markedByUserId", "method", "providerRef", "status", "updatedAt" FROM "Payment";
DROP TABLE "Payment";
ALTER TABLE "new_Payment" RENAME TO "Payment";
CREATE INDEX "Payment_clubId_status_idx" ON "Payment"("clubId", "status");
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");
CREATE INDEX "Payment_intentId_idx" ON "Payment"("intentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_clubId_status_createdAt_idx" ON "Order"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_expiresAt_idx" ON "Order"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_holdId_key" ON "OrderItem"("holdId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_createdAt_idx" ON "OrderItem"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_slotId_startAtUtc_idx" ON "OrderItem"("slotId", "startAtUtc");

-- CreateIndex
CREATE INDEX "OrderItem_seatId_startAtUtc_idx" ON "OrderItem"("seatId", "startAtUtc");

-- CreateIndex
CREATE INDEX "PaymentIntent_orderId_status_createdAt_idx" ON "PaymentIntent"("orderId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_clubId_status_createdAt_idx" ON "PaymentIntent"("clubId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_userId_createdAt_idx" ON "PaymentIntent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_providerRef_idx" ON "PaymentIntent"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_userId_issueDate_idx" ON "Invoice"("userId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_clubId_issueDate_idx" ON "Invoice"("clubId", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_status_issueDate_idx" ON "Invoice"("status", "issueDate");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_createdAt_idx" ON "InvoiceItem"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceItem_orderItemId_idx" ON "InvoiceItem"("orderItemId");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "login" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
