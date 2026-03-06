import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import {
  CLUB_STATUSES,
  allowedTransitionFrom,
  canTransitionClubStatus,
  normalizeClubStatus,
} from '@/src/lib/clubLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { loadClubOnboardingReport } from '@/src/lib/onboardingChecklist'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true, publishedAt: true },
  })

  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const currentStatus = normalizeClubStatus(club.status)
  if (currentStatus === CLUB_STATUSES.PUBLISHED) {
    return NextResponse.json({
      clubId: club.id,
      status: CLUB_STATUSES.PUBLISHED,
      publishedAt: club.publishedAt,
    })
  }

  if (!canTransitionClubStatus(currentStatus, 'publish')) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: `Cannot publish club from status ${currentStatus}.`,
        currentStatus,
        allowedFrom: allowedTransitionFrom('publish'),
      },
      { status: 409 },
    )
  }

  const onboarding = await loadClubOnboardingReport(clubId)
  if (!onboarding.canPublish) {
    return NextResponse.json(
      {
        code: 'PUBLISH_BLOCKED',
        error: 'Publish blocked by onboarding checklist.',
        blockers: onboarding.publishBlockers,
        details: onboarding.publishBlockerDetails,
      },
      { status: 409 },
    )
  }

  const now = new Date()
  const updated = await prisma.club.update({
    where: { id: club.id },
    data: {
      status: CLUB_STATUSES.PUBLISHED,
      publishedAt: now,
      pauseReason: null,
      pauseUntil: null,
    },
    select: {
      id: true,
      status: true,
      publishedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: club.id,
      actorUserId: context.userId,
      action: 'club.published',
      entityType: 'club',
      entityId: club.id,
      metadata: JSON.stringify({
        publishedAt: now.toISOString(),
      }),
    },
  })

  return NextResponse.json({
    clubId: updated.id,
    status: updated.status,
    publishedAt: updated.publishedAt,
  })
}
