import { NextRequest, NextResponse } from 'next/server'
import { RescheduleFlowError, confirmRescheduleIntent, createRescheduleIntent } from '@/src/lib/rescheduleService'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
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

type RouteContext = { params: Promise<{ bookingId: string }> }

type PayMode = 'ONLINE' | 'OFFLINE' | 'NONE'

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('reschedule')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.BOOKINGS_MANAGE)
    const { bookingId: rawBookingId } = await routeContext.params
    const bookingId = Number(rawBookingId)
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
    }

    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const newSlotId =
      typeof payload.newSlotId === 'string' ? payload.newSlotId.trim() : ''
    const newSeatId =
      typeof payload.newSeatId === 'string' ? payload.newSeatId.trim() : undefined
    const packageId =
      typeof payload.packageId === 'string' ? payload.packageId.trim() : undefined
    const payMode: PayMode =
      payload.payMode === 'ONLINE' || payload.payMode === 'OFFLINE' || payload.payMode === 'NONE'
        ? (payload.payMode as PayMode)
        : 'NONE'

    if (!newSlotId) {
      return NextResponse.json({ error: 'newSlotId is required.' }, { status: 400 })
    }

    const reasonCheck = requireOverrideReason(payload)
    if (!reasonCheck.ok) return reasonCheck.response

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clubId: true },
    })
    if (!booking || !booking.clubId) {
      return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
    }

    const intent = await createRescheduleIntent({
      bookingId,
      clubId: booking.clubId,
      mode: 'STAFF',
      actorUserId: admin.userId,
      newSlotId,
      newSeatId,
      packageId,
      allowStaffOverride: true,
      reason: `[${reasonCheck.value.reasonCode}] ${reasonCheck.value.reason}`,
    })

    const confirm = await confirmRescheduleIntent({
      rescheduleId: intent.rescheduleId,
      clubId: booking.clubId,
      mode: 'STAFF',
      actorUserId: admin.userId,
      allowStaffOverride: true,
      payMode,
      reason: `[${reasonCheck.value.reasonCode}] ${reasonCheck.value.reason}`,
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId: booking.clubId,
      bookingId,
      action: 'platform.booking.rescheduled_override',
      entityType: 'booking',
      entityId: String(bookingId),
      metadata: {
        reasonCode: reasonCheck.value.reasonCode,
        reason: reasonCheck.value.reason,
        intent,
        confirm,
      },
    })

    return NextResponse.json({
      intent,
      booking: confirm,
    })
  } catch (error) {
    if (error instanceof RescheduleFlowError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status },
      )
    }
    return adminErrorResponse(error)
  }
}
