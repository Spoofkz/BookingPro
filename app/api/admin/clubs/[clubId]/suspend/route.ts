import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, createPlatformAuditLog, requireOverrideReason } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ clubId: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.CLUBS_MANAGE)
    const { clubId } = await routeContext.params
    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }
    const reasonCheck = requireOverrideReason(payload)
    if (!reasonCheck.ok) return reasonCheck.response
    const { reasonCode, reason } = reasonCheck.value

    const before = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true, status: true, pauseReason: true, pauseUntil: true },
    })
    if (!before) return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })

    const updated = await prisma.club.update({
      where: { id: clubId },
      data: {
        status: 'SUSPENDED',
        pauseReason: `[${reasonCode}] ${reason}`,
        pauseUntil: null,
      },
      select: { id: true, status: true, pauseReason: true },
    })

    await prisma.clubVerification.upsert({
      where: { clubId },
      update: {
        status: 'SUSPENDED',
        reviewedAt: new Date(),
        reviewedByUserId: admin.userId,
        notes: reason,
      },
      create: {
        clubId,
        status: 'SUSPENDED',
        reviewedAt: new Date(),
        reviewedByUserId: admin.userId,
        notes: reason,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.club.suspended',
      entityType: 'club',
      entityId: clubId,
      metadata: { before, after: updated, reasonCode, reason },
    })

    return NextResponse.json({
      clubId: updated.id,
      status: updated.status,
      pauseReason: updated.pauseReason,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

