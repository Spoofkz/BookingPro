import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ disputeId: string }> }

export async function GET(_: Request, routeContext: RouteContext) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.DISPUTES_READ)
    const { disputeId } = await routeContext.params

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        club: { select: { id: true, name: true, slug: true, status: true } },
        booking: { select: { id: true, status: true, clubId: true, slotId: true, seatId: true } },
        payment: { select: { id: true, status: true, amountCents: true, method: true } },
        customerUser: { select: { id: true, name: true, email: true, phone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })
    if (!dispute) return NextResponse.json({ error: 'Dispute was not found.' }, { status: 404 })

    const [notes, audit] = await Promise.all([
      prisma.platformNote.findMany({
        where: { entityType: 'DISPUTE', entityId: dispute.id },
        include: { createdByUser: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: { entityType: 'dispute', entityId: dispute.id },
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return NextResponse.json({
      dispute,
      notes: notes.map((note) => ({
        noteId: note.id,
        text: note.text,
        createdAt: note.createdAt,
        createdBy: note.createdByUser,
      })),
      audit,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

