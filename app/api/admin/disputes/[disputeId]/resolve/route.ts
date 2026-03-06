import { DisputeStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import {
  adminErrorResponse,
  asTrimmedString,
  createPlatformAuditLog,
} from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ disputeId: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.DISPUTES_MANAGE)
    const { disputeId } = await routeContext.params
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const resolutionSummary = asTrimmedString(payload.resolutionSummary)?.slice(0, 5000) ?? null
    if (!resolutionSummary) {
      return NextResponse.json({ error: 'resolutionSummary is required.' }, { status: 400 })
    }
    const status =
      asTrimmedString(payload.status) === DisputeStatus.REJECTED
        ? DisputeStatus.REJECTED
        : DisputeStatus.RESOLVED

    const before = await prisma.dispute.findUnique({ where: { id: disputeId } })
    if (!before) return NextResponse.json({ error: 'Dispute was not found.' }, { status: 404 })

    const updated = await prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status,
        resolutionSummary,
        assignedToUserId: admin.userId,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId: updated.clubId,
      bookingId: updated.bookingId,
      action: 'platform.dispute.resolved',
      entityType: 'dispute',
      entityId: updated.id,
      metadata: {
        before: { status: before.status, resolutionSummary: before.resolutionSummary },
        after: { status: updated.status, resolutionSummary: updated.resolutionSummary },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

