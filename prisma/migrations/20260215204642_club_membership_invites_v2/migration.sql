-- AlterTable
ALTER TABLE "ClubMembership" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "ClubMembership" ADD COLUMN "inviteExpiresAt" DATETIME;
ALTER TABLE "ClubMembership" ADD COLUMN "inviteToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClubMembership_inviteToken_key" ON "ClubMembership"("inviteToken");

-- CreateIndex
CREATE INDEX "ClubMembership_inviteExpiresAt_idx" ON "ClubMembership"("inviteExpiresAt");

