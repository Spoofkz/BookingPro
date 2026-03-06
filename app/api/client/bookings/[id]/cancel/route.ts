import { BookingStatus, MembershipActorRole } from '@prisma/client'
import { NextResponse } from 'next/server'
import { isCancellationAllowed } from '@/src/lib/bookingPolicies'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  ClientOwnershipError,
  parseBookingId,
  requireOwnedBooking,
} from '@/src/lib/clientOwnership'
import { reverseMembershipConsumptionForBooking } from '@/src/lib/membershipService'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

function slotStartAt(booking: { checkIn: Date; slot?: { startAtUtc: Date } | null }) {
  return booking.slot?.startAtUtc ?? booking.checkIn
}

export async function POST(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const bookingId = parseBookingId(id)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const owned = await requireOwnedBooking({
      bookingId,
      userId: context.userId,
      email: context.profile.email,
    })

    if (owned.status === BookingStatus.CANCELED) {
      return NextResponse.json(owned)
    }

    if (owned.clubId) {
      const club = await prisma.club.findUnique({
        where: { id: owned.clubId },
        select: { cancellationPolicyJson: true },
      })
      const allowed = isCancellationAllowed({
        slotStartAt: slotStartAt(owned),
        policyJson: club?.cancellationPolicyJson ?? null,
      })
      if (!allowed) {
        return NextResponse.json(
          {
            code: 'POLICY_VIOLATION',
            error: 'Cancellation cutoff policy does not allow canceling this booking now.',
          },
          { status: 409 },
        )
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELED,
          canceledAt: new Date(),
          canceledByUserId: context.userId,
          cancelReason: 'client_self_cancel',
        },
        include: {
          room: true,
          slot: true,
          payments: {
            orderBy: [{ createdAt: 'desc' }],
          },
        },
      })

      const membershipReversal = await reverseMembershipConsumptionForBooking({
        tx,
        booking: {
          id: booking.id,
          clubId: booking.clubId,
          membershipConsumptionJson: booking.membershipConsumptionJson,
          membershipReversedAt: booking.membershipReversedAt,
        },
        actorUserId: context.userId,
        actorRole: MembershipActorRole.CLIENT,
      })

      await tx.auditLog.create({
        data: {
          clubId: booking.clubId,
          actorUserId: context.userId,
          action: 'booking.canceled',
          entityType: 'booking',
          entityId: String(booking.id),
          bookingId: booking.id,
          metadata: JSON.stringify({
            origin: 'client_api',
            reason: 'client_self_cancel',
          }),
        },
      })

      return {
        booking,
        membershipReversal,
      }
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ClientOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
