import { NextResponse } from 'next/server'
import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { loadClubOnboardingReport } from '@/src/lib/onboardingChecklist'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ clubId: string }> }

export async function POST(_: Request, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.CLUBS_MANAGE)
    const { clubId } = await routeContext.params

    const existing = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, status: true, pauseReason: true, pauseUntil: true, publishedAt: true },
    })
    if (!existing) return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })

    const onboarding = await loadClubOnboardingReport(clubId)
    if (!onboarding.canPublish) {
      return NextResponse.json(
        {
          code: 'PUBLISH_BLOCKED',
          error: 'Resume blocked by onboarding checklist.',
          blockers: onboarding.publishBlockers,
          details: onboarding.publishBlockerDetails,
        },
        { status: 409 },
      )
    }

    const updated = await prisma.club.update({
      where: { id: clubId },
      data: {
        status: CLUB_STATUSES.PUBLISHED,
        pauseReason: null,
        pauseUntil: null,
        publishedAt: new Date(),
      },
      select: { id: true, status: true, publishedAt: true },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.club.resumed',
      entityType: 'club',
      entityId: clubId,
      metadata: { before: existing, after: updated },
    })

    return NextResponse.json({
      clubId: updated.id,
      status: updated.status,
      publishedAt: updated.publishedAt,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

