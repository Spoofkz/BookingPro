import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import {
  CLUB_STATUSES,
  allowedTransitionFrom,
  canTransitionClubStatus,
  normalizeClubStatus,
} from '@/src/lib/clubLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type PausePayload = {
  reason?: string
  pauseUntil?: string | null
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: PausePayload
  try {
    payload = (await request.json()) as PausePayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const pauseUntil =
    payload.pauseUntil === undefined || payload.pauseUntil === null
      ? null
      : new Date(payload.pauseUntil)
  if (pauseUntil && Number.isNaN(pauseUntil.getTime())) {
    return NextResponse.json({ error: 'pauseUntil is invalid.' }, { status: 400 })
  }

  const existing = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const currentStatus = normalizeClubStatus(existing.status)
  if (!canTransitionClubStatus(currentStatus, 'pause')) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: `Cannot pause club from status ${currentStatus}.`,
        currentStatus,
        allowedFrom: allowedTransitionFrom('pause'),
      },
      { status: 409 },
    )
  }

  const reason = payload.reason?.trim() || null
  const updated = await prisma.club.update({
    where: { id: clubId },
    data: {
      status: CLUB_STATUSES.PAUSED,
      pauseReason: reason,
      pauseUntil,
    },
    select: {
      id: true,
      status: true,
      pauseReason: true,
      pauseUntil: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.paused',
      entityType: 'club',
      entityId: clubId,
      metadata: JSON.stringify({
        reason,
        pauseUntil: pauseUntil?.toISOString() ?? null,
      }),
    },
  })

  return NextResponse.json({
    clubId: updated.id,
    status: updated.status,
    reason: updated.pauseReason,
    pauseUntil: updated.pauseUntil,
  })
}
