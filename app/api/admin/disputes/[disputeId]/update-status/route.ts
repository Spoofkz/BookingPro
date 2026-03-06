import { DisputeStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ disputeId: string }> }

function parseStatus(value: string | null) {
  if (!value) return null
  if (value === DisputeStatus.OPEN) return value
  if (value === DisputeStatus.IN_REVIEW) return value
  if (value === DisputeStatus.RESOLVED) return value
  if (value === DisputeStatus.REJECTED) return value
  return null
}

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

    const status = parseStatus(asTrimmedString(payload.status))
    if (!status) return NextResponse.json({ error: 'status is invalid.' }, { status: 400 })
    const assignedToUserId = asTrimmedString(payload.assignedToUserId)
    const note = asTrimmedString(payload.note)?.slice(0, 2000) ?? null

    const before = await prisma.dispute.findUnique({ where: { id: disputeId } })
    if (!before) return NextResponse.json({ error: 'Dispute was not found.' }, { status: 404 })

    const updated = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status,
          assignedToUserId: assignedToUserId ?? undefined,
        },
      })

      if (note) {
        await tx.platformNote.create({
          data: {
            entityType: 'DISPUTE',
            entityId: dispute.id,
            clubId: dispute.clubId,
            text: note,
            createdByUserId: admin.userId,
          },
        })
      }

      return dispute
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId: updated.clubId,
      bookingId: updated.bookingId,
      action: 'platform.dispute.status_updated',
      entityType: 'dispute',
      entityId: updated.id,
      metadata: {
        before: { status: before.status, assignedToUserId: before.assignedToUserId },
        after: { status: updated.status, assignedToUserId: updated.assignedToUserId },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

