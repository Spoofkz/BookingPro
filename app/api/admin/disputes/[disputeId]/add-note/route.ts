import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
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
    const text = asTrimmedString(payload.text)?.slice(0, 2000) ?? null
    if (!text) return NextResponse.json({ error: 'text is required.' }, { status: 400 })

    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { id: true, clubId: true, bookingId: true },
    })
    if (!dispute) return NextResponse.json({ error: 'Dispute was not found.' }, { status: 404 })

    const note = await prisma.platformNote.create({
      data: {
        entityType: 'DISPUTE',
        entityId: dispute.id,
        clubId: dispute.clubId,
        text,
        createdByUserId: admin.userId,
      },
      include: {
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId: dispute.clubId,
      bookingId: dispute.bookingId,
      action: 'platform.dispute.note_added',
      entityType: 'dispute',
      entityId: dispute.id,
      metadata: { noteId: note.id },
    })

    return NextResponse.json({
      noteId: note.id,
      text: note.text,
      createdAt: note.createdAt,
      createdBy: note.createdByUser,
    }, { status: 201 })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

