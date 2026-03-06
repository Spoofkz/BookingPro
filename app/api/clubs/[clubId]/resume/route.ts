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

  const existing = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const currentStatus = normalizeClubStatus(existing.status)
  if (!canTransitionClubStatus(currentStatus, 'resume')) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: `Cannot resume club from status ${currentStatus}.`,
        currentStatus,
        allowedFrom: allowedTransitionFrom('resume'),
      },
      { status: 409 },
    )
  }

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
    select: {
      id: true,
      status: true,
      publishedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.resumed',
      entityType: 'club',
      entityId: clubId,
      metadata: JSON.stringify({
        resumedAt: new Date().toISOString(),
      }),
    },
  })

  return NextResponse.json({
    clubId: updated.id,
    status: updated.status,
    publishedAt: updated.publishedAt,
  })
}
