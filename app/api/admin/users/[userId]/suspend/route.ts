import { NextRequest, NextResponse } from 'next/server'
import { UserStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import {
  adminErrorResponse,
  createPlatformAuditLog,
  requireOverrideReason,
} from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ userId: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
    const { userId } = await routeContext.params
    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }
    const reasonCheck = requireOverrideReason(payload)
    if (!reasonCheck.ok) return reasonCheck.response

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    })
    if (!before) return NextResponse.json({ error: 'User was not found.' }, { status: 404 })

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.DISABLED },
      select: { id: true, status: true, updatedAt: true },
    })

    await prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: 'platform_user_suspended',
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'platform.user.suspended',
      entityType: 'user',
      entityId: userId,
      metadata: {
        before,
        after: updated,
        reasonCode: reasonCheck.value.reasonCode,
        reason: reasonCheck.value.reason,
      },
    })

    return NextResponse.json({
      userId: updated.id,
      status: updated.status,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

