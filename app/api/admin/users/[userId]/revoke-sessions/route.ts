import { NextRequest, NextResponse } from 'next/server'
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

    const result = await prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: 'platform_admin_revoke_sessions',
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'platform.user.sessions_revoked',
      entityType: 'user',
      entityId: userId,
      metadata: {
        count: result.count,
        reasonCode: reasonCheck.value.reasonCode,
        reason: reasonCheck.value.reason,
      },
    })

    return NextResponse.json({
      userId,
      revokedSessions: result.count,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

