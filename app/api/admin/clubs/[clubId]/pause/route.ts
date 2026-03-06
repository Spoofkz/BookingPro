import { NextRequest, NextResponse } from 'next/server'
import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'
import { createPlatformAuditLog, adminErrorResponse, asTrimmedString, parseDateOrNull } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ clubId: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.CLUBS_MANAGE)
    const { clubId } = await routeContext.params
    let payload: Record<string, unknown> = {}
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      payload = {}
    }

    const reason = asTrimmedString(payload.reason)
    const pauseUntilRaw = asTrimmedString(payload.pauseUntil)
    const pauseUntil = pauseUntilRaw ? parseDateOrNull(pauseUntilRaw) : null
    if (pauseUntilRaw && !pauseUntil) {
      return NextResponse.json({ error: 'pauseUntil is invalid.' }, { status: 400 })
    }

    const before = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, status: true, pauseReason: true, pauseUntil: true },
    })
    if (!before) return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })

    const updated = await prisma.club.update({
      where: { id: clubId },
      data: {
        status: CLUB_STATUSES.PAUSED,
        pauseReason: reason,
        pauseUntil,
      },
      select: { id: true, status: true, pauseReason: true, pauseUntil: true },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.club.paused',
      entityType: 'club',
      entityId: clubId,
      metadata: { before, after: updated, reason },
    })

    return NextResponse.json({
      clubId: updated.id,
      status: updated.status,
      pauseReason: updated.pauseReason,
      pauseUntil: updated.pauseUntil,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

