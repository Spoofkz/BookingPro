import { BookingStatus, MembershipActorRole } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { prisma } from '@/src/lib/prisma'
import { reverseMembershipConsumptionForBooking } from '@/src/lib/membershipService'
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

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.BOOKINGS_MANAGE)
    const { bookingId: rawBookingId } = await routeContext.params
    const bookingId = Number(rawBookingId)
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
    }

    let payload: unknown = {}
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }
    const reasonCheck = requireOverrideReason(payload)
    if (!reasonCheck.ok) return reasonCheck.response

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { room: true },
      })
      if (!existing) {
        throw new Error('Booking was not found.')
      }

      if (existing.status === BookingStatus.CANCELED) {
        return { booking: existing, membershipReversal: null, before: existing, alreadyCanceled: true }
      }

      const before = {
        id: existing.id,
        status: existing.status,
        paymentStatus: existing.paymentStatus,
        slotId: existing.slotId,
        seatId: existing.seatId,
      }

      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELED,
          canceledAt: new Date(),
          canceledByUserId: admin.userId,
          cancelReason: `[${reasonCheck.value.reasonCode}] ${reasonCheck.value.reason}`,
        },
        include: { room: true },
      })

      const membershipReversal = await reverseMembershipConsumptionForBooking({
        tx,
        booking: {
          id: booking.id,
          clubId: booking.clubId,
          membershipConsumptionJson: booking.membershipConsumptionJson,
          membershipReversedAt: booking.membershipReversedAt,
        },
        actorUserId: admin.userId,
        actorRole: MembershipActorRole.STAFF,
      })

      await createPlatformAuditLog({
        tx,
        actorUserId: admin.userId,
        clubId: booking.clubId,
        bookingId: booking.id,
        action: 'platform.booking.canceled_override',
        entityType: 'booking',
        entityId: String(booking.id),
        metadata: {
          before,
          after: {
            status: booking.status,
            canceledAt: booking.canceledAt,
            cancelReason: booking.cancelReason,
          },
          reasonCode: reasonCheck.value.reasonCode,
          reason: reasonCheck.value.reason,
          membershipReversal,
        },
      })

      return { booking, membershipReversal, before, alreadyCanceled: false }
    })

    if (result.booking.clubId && result.booking.slotId && result.booking.seatId) {
      invalidateAvailabilityCacheForClubSlot(result.booking.clubId, result.booking.slotId)
    }

    return NextResponse.json({
      bookingId: result.booking.id,
      status: result.booking.status,
      cancelReason: result.booking.cancelReason,
      membershipReversal: result.membershipReversal,
      alreadyCanceled: result.alreadyCanceled,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Booking was not found.') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return adminErrorResponse(error)
  }
}

