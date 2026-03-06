import { BookingStatus } from '@prisma/client'
import { NextResponse } from 'next/server'
import { isCancellationAllowed, resolveCancellationPolicy, resolveReschedulePolicy } from '@/src/lib/bookingPolicies'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  ClientOwnershipError,
  parseBookingId,
  requireOwnedBooking,
} from '@/src/lib/clientOwnership'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const bookingId = parseBookingId(id)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const booking = await requireOwnedBooking({
      bookingId,
      userId: context.userId,
      email: context.profile.email,
    })

    const slotStartAt = booking.slot?.startAtUtc ?? booking.checkIn
    const cancellationPolicy = resolveCancellationPolicy(booking.club?.cancellationPolicyJson ?? null)
    const reschedulePolicy = resolveReschedulePolicy(booking.club?.reschedulePolicyJson ?? null)

    const cancellationDeadline =
      cancellationPolicy.cutoffMinutes > 0
        ? new Date(slotStartAt.getTime() - cancellationPolicy.cutoffMinutes * 60_000)
        : null
    const rescheduleDeadline =
      reschedulePolicy.rescheduleCutoffMinutesBeforeStart > 0
        ? new Date(
            slotStartAt.getTime() - reschedulePolicy.rescheduleCutoffMinutesBeforeStart * 60_000,
          )
        : null

    const cancelAllowed = isCancellationAllowed({
      slotStartAt,
      policyJson: booking.club?.cancellationPolicyJson ?? null,
    })
    const now = new Date()
    const allowRescheduleByStatus =
      booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.CHECKED_IN
    const allowRescheduleByTime =
      reschedulePolicy.allowRescheduleAfterStart || now < slotStartAt
    const allowRescheduleByCutoff =
      !rescheduleDeadline || now <= rescheduleDeadline
    const allowRescheduleByCount =
      booking.rescheduleCount < reschedulePolicy.maxReschedulesPerBooking
    const rescheduleAllowed =
      reschedulePolicy.rescheduleEnabled &&
      allowRescheduleByStatus &&
      allowRescheduleByTime &&
      allowRescheduleByCutoff &&
      allowRescheduleByCount

    const [auditRows, bookingEvents] = await Promise.all([
      prisma.auditLog.findMany({
        where: { bookingId: booking.id },
        orderBy: [{ createdAt: 'asc' }],
        take: 100,
        select: {
          id: true,
          action: true,
          actorUserId: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.bookingEvent.findMany({
        where: { bookingId: booking.id },
        orderBy: [{ createdAt: 'asc' }],
        take: 50,
        select: {
          id: true,
          eventType: true,
          actorUserId: true,
          createdAt: true,
          reason: true,
          beforeJson: true,
          afterJson: true,
        },
      }),
    ])

    const timeline = [
      {
        id: `booking-created-${booking.id}`,
        type: 'BOOKING_CREATED',
        at: booking.createdAt,
        actorUserId: booking.createdByUserId,
        description: 'Booking created.',
      },
      ...(booking.checkedInAt
        ? [
            {
              id: `booking-checked-in-${booking.id}`,
              type: 'BOOKING_CHECKED_IN',
              at: booking.checkedInAt,
              actorUserId: booking.checkedInByUserId,
              description: 'Booking checked in.',
            },
          ]
        : []),
      ...(booking.checkedOutAt
        ? [
            {
              id: `booking-checked-out-${booking.id}`,
              type: 'BOOKING_COMPLETED',
              at: booking.checkedOutAt,
              actorUserId: null,
              description: 'Booking completed.',
            },
          ]
        : []),
      ...(booking.canceledAt
        ? [
            {
              id: `booking-canceled-${booking.id}`,
              type: 'BOOKING_CANCELED',
              at: booking.canceledAt,
              actorUserId: booking.canceledByUserId,
              description: booking.cancelReason || 'Booking canceled.',
            },
          ]
        : []),
      ...auditRows.map((row) => ({
        id: `audit-${row.id}`,
        type: row.action,
        at: row.createdAt,
        actorUserId: row.actorUserId,
        description: row.action,
      })),
      ...bookingEvents.map((event) => ({
        id: `event-${event.id}`,
        type: event.eventType,
        at: event.createdAt,
        actorUserId: event.actorUserId,
        description: event.reason || event.eventType,
      })),
    ].sort((a, b) => +new Date(a.at) - +new Date(b.at))

    await prisma.auditLog.create({
      data: {
        clubId: booking.club?.id ?? booking.clubId,
        actorUserId: context.userId,
        action: 'client.booking.viewed',
        entityType: 'booking',
        entityId: String(booking.id),
        bookingId: booking.id,
      },
    })

    return NextResponse.json({
      ...booking,
      policies: {
        cancellation: {
          cutoffMinutes: cancellationPolicy.cutoffMinutes,
          deadline: cancellationDeadline,
          allowedNow: cancelAllowed,
        },
        reschedule: {
          enabled: reschedulePolicy.rescheduleEnabled,
          cutoffMinutesBeforeStart: reschedulePolicy.rescheduleCutoffMinutesBeforeStart,
          deadline: rescheduleDeadline,
          maxReschedulesPerBooking: reschedulePolicy.maxReschedulesPerBooking,
          currentRescheduleCount: booking.rescheduleCount,
          allowAfterStart: reschedulePolicy.allowRescheduleAfterStart,
          allowedNow: rescheduleAllowed,
        },
      },
      timeline,
    })
  } catch (error) {
    if (error instanceof ClientOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
