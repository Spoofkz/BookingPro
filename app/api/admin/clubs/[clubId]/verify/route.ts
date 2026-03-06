import { NextRequest, NextResponse } from 'next/server'
import { ClubVerificationStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ clubId: string }> }

function parseVerificationStatus(value: string | null) {
  if (!value) return null
  if (value === ClubVerificationStatus.UNVERIFIED) return value
  if (value === ClubVerificationStatus.PENDING_REVIEW) return value
  if (value === ClubVerificationStatus.VERIFIED) return value
  if (value === ClubVerificationStatus.REJECTED) return value
  if (value === ClubVerificationStatus.SUSPENDED) return value
  return null
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.VERIFY_CLUB)
    const { clubId } = await routeContext.params

    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const status = parseVerificationStatus(asTrimmedString(payload.status))
    if (!status) {
      return NextResponse.json({ error: 'status is invalid.' }, { status: 400 })
    }
    const notes = asTrimmedString(payload.notes)?.slice(0, 2000) ?? null
    const documentsJson =
      payload.documents !== undefined ? JSON.stringify(payload.documents ?? null) : null

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true },
    })
    if (!club) {
      return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
    }

    const before = await prisma.clubVerification.findUnique({ where: { clubId } })
    const now = new Date()
    const verification = await prisma.clubVerification.upsert({
      where: { clubId },
      update: {
        status,
        reviewedAt: now,
        reviewedByUserId: admin.userId,
        notes,
        documentsJson: documentsJson ?? before?.documentsJson ?? null,
        submittedAt:
          status === ClubVerificationStatus.PENDING_REVIEW
            ? (before?.submittedAt ?? now)
            : before?.submittedAt ?? null,
      },
      create: {
        clubId,
        status,
        submittedAt: status === ClubVerificationStatus.PENDING_REVIEW ? now : null,
        reviewedAt:
          status === ClubVerificationStatus.PENDING_REVIEW ? null : now,
        reviewedByUserId:
          status === ClubVerificationStatus.PENDING_REVIEW ? null : admin.userId,
        notes,
        documentsJson,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.club.verification_updated',
      entityType: 'club_verification',
      entityId: clubId,
      metadata: {
        before: before
          ? {
              status: before.status,
              reviewedAt: before.reviewedAt,
              reviewedByUserId: before.reviewedByUserId,
            }
          : null,
        after: {
          status: verification.status,
          reviewedAt: verification.reviewedAt,
          reviewedByUserId: verification.reviewedByUserId,
        },
        notes,
      },
    })

    return NextResponse.json({
      clubId: verification.clubId,
      status: verification.status,
      submittedAt: verification.submittedAt,
      reviewedAt: verification.reviewedAt,
      reviewedByUserId: verification.reviewedByUserId,
      notes: verification.notes,
      documentsJson: verification.documentsJson,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

