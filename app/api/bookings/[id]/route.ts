import {
  BookingStatus,
  CustomerRecordStatus,
  MembershipActorRole,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  Role,
} from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { expireActiveHolds } from '@/src/lib/availabilityService'
import { isCancellationAllowed, isCheckInAllowed } from '@/src/lib/bookingPolicies'
import {
  activeBookingStatuses,
  isOperationalBookingStatus,
  seatBlockingBookingStatuses,
} from '@/src/lib/bookingLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'
import { CommerceError, markOfflineOrderPaidByStaff } from '@/src/lib/commerceService'
import { MembershipFlowError, reverseMembershipConsumptionForBooking } from '@/src/lib/membershipService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type BookingAction =
  | 'cancel'
  | 'mark_paid'
  | 'check_in'
  | 'check_out'
  | 'move_seat'
  | 'attach_customer'

type UpdateBookingBody = {
  action?: BookingAction
  roomId?: number
  newSeatId?: string
  customerId?: string
  guestName?: string
  guestEmail?: string
  checkIn?: string
  checkOut?: string
  guests?: number
  notes?: string | null
  cancelReason?: string | null
  status?: BookingStatus
}

function parseBookingId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id < 1) {
    return null
  }
  return id
}

function parseIsoDate(input: string) {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

function parseStatus(input?: string): BookingStatus | null {
  if (!input) return null
  if (input === BookingStatus.HELD) return BookingStatus.HELD
  if (input === BookingStatus.PENDING) return BookingStatus.PENDING
  if (input === BookingStatus.CONFIRMED) return BookingStatus.CONFIRMED
  if (input === BookingStatus.CHECKED_IN) return BookingStatus.CHECKED_IN
  if (input === BookingStatus.CANCELED) return BookingStatus.CANCELED
  if (input === BookingStatus.COMPLETED) return BookingStatus.COMPLETED
  if (input === BookingStatus.NO_SHOW) return BookingStatus.NO_SHOW
  return null
}

function isActiveStatus(status: BookingStatus) {
  return (
    status === BookingStatus.HELD ||
    status === BookingStatus.PENDING ||
    status === BookingStatus.CONFIRMED ||
    status === BookingStatus.CHECKED_IN
  )
}

function parseAction(input?: string): BookingAction | null {
  if (!input) return null
  if (input === 'cancel') return 'cancel'
  if (input === 'mark_paid') return 'mark_paid'
  if (input === 'check_in') return 'check_in'
  if (input === 'check_out') return 'check_out'
  if (input === 'move_seat') return 'move_seat'
  if (input === 'attach_customer') return 'attach_customer'
  return null
}

async function canClientAccessBooking(
  booking: { clientUserId: string | null; guestEmail: string },
  context: Awaited<ReturnType<typeof getCabinetContext>>,
) {
  const email = context.profile.email?.toLowerCase() || ''
  return booking.clientUserId === context.userId || booking.guestEmail === email
}

function permissionForAction(action: BookingAction | null) {
  if (action === 'cancel') return PERMISSIONS.BOOKING_CANCEL
  if (action === 'mark_paid') return PERMISSIONS.PAYMENT_MARK_PAID
  if (action === 'check_in' || action === 'check_out') return PERMISSIONS.BOOKING_CHECK_IN
  if (action === 'move_seat') return PERMISSIONS.BOOKING_MOVE_SEAT
  if (action === 'attach_customer') return PERMISSIONS.CUSTOMER_WRITE
  return PERMISSIONS.BOOKING_CREATE
}

function invalidateSeatAvailability(booking: {
  clubId: string | null
  slotId: string | null
  seatId: string | null
}) {
  if (booking.clubId && booking.slotId && booking.seatId) {
    invalidateAvailabilityCacheForClubSlot(booking.clubId, booking.slotId)
  }
}

function slotStartAt(booking: { checkIn: Date; slot?: { startAtUtc: Date } | null }) {
  return booking.slot?.startAtUtc ?? booking.checkIn
}

function ensureStaffBookingAccess(params: {
  request: NextRequest
  context: Awaited<ReturnType<typeof getCabinetContext>>
  bookingClubId: string | null
  action: BookingAction | null
}) {
  const { request, context, bookingClubId, action } = params
  if (!bookingClubId) {
    throw new AuthorizationError('NOT_A_MEMBER', 'Booking is not associated with any club.', 403)
  }

  const requestedClubId = resolveClubContextFromRequest(request, context, { required: true })
  if (!requestedClubId) {
    throw new AuthorizationError(
      'CLUB_CONTEXT_REQUIRED',
      'Active club context is required. Set X-Club-Id header.',
      400,
    )
  }

  if (requestedClubId !== bookingClubId) {
    throw new AuthorizationError(
      'NOT_A_MEMBER',
      'Booking does not belong to active club context.',
      403,
    )
  }

  requirePermissionInClub(context, requestedClubId, permissionForAction(action))
}

function ensureStaffBookingReadAccess(params: {
  request: NextRequest
  context: Awaited<ReturnType<typeof getCabinetContext>>
  bookingClubId: string | null
}) {
  const { request, context, bookingClubId } = params
  if (!bookingClubId) {
    throw new AuthorizationError('NOT_A_MEMBER', 'Booking is not associated with any club.', 403)
  }

  const requestedClubId = resolveClubContextFromRequest(request, context, { required: true })
  if (!requestedClubId) {
    throw new AuthorizationError(
      'CLUB_CONTEXT_REQUIRED',
      'Active club context is required. Set X-Club-Id header.',
      400,
    )
  }

  if (requestedClubId !== bookingClubId) {
    throw new AuthorizationError(
      'NOT_A_MEMBER',
      'Booking does not belong to active club context.',
      403,
    )
  }

  requirePermissionInClub(context, requestedClubId, PERMISSIONS.BOOKING_READ)
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id: rawId } = await context.params
  const bookingId = parseBookingId(rawId)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  const authContext = await getCabinetContext()
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      slot: {
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          status: true,
        },
      },
      payments: {
        orderBy: [{ createdAt: 'desc' }],
      },
    },
  })

  if (!booking) {
    return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
  }

  const clientOwnsBooking = await canClientAccessBooking(booking, authContext)
  if (authContext.activeRole === Role.CLIENT) {
    if (!clientOwnsBooking) {
      return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
    }
    return NextResponse.json(booking)
  }

  try {
    ensureStaffBookingReadAccess({
      request,
      context: authContext,
      bookingClubId: booking.clubId,
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  return NextResponse.json(booking)
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id: rawId } = await context.params
  const bookingId = parseBookingId(rawId)

  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  const authContext = await getCabinetContext()
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room: true,
      slot: {
        select: {
          startAtUtc: true,
          endAtUtc: true,
        },
      },
    },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
  }

  let body: UpdateBookingBody

  try {
    body = (await request.json()) as UpdateBookingBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const action = parseAction(body.action)
  if (body.action !== undefined && !action) {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  }
  const cancelReason = body.cancelReason?.trim() || null

  const clientOwnsBooking = await canClientAccessBooking(existing, authContext)

  if (clientOwnsBooking && action === 'cancel') {
    // Allow self-service cancellation regardless of currently selected active role.
  } else if (authContext.activeRole === Role.CLIENT) {
    return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
  } else {
    try {
      ensureStaffBookingAccess({
        request,
        context: authContext,
        bookingClubId: existing.clubId,
        action,
      })
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  if (action) {
    if (action === 'cancel') {
      if (existing.status === BookingStatus.CANCELED) {
        return NextResponse.json(existing)
      }
      if (existing.clubId) {
        const club = await prisma.club.findUnique({
          where: { id: existing.clubId },
          select: { cancellationPolicyJson: true },
        })
        const allowed = isCancellationAllowed({
          slotStartAt: slotStartAt(existing),
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
            canceledByUserId: authContext.userId,
            cancelReason,
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
          actorUserId: authContext.userId,
          actorRole:
            authContext.activeRole === Role.CLIENT
              ? MembershipActorRole.CLIENT
              : MembershipActorRole.STAFF,
        })

        if (booking.clubId) {
          await tx.auditLog.create({
            data: {
              clubId: booking.clubId,
              actorUserId: authContext.userId,
              action: 'booking.canceled',
              entityType: 'booking',
              entityId: String(booking.id),
              bookingId: booking.id,
              metadata: cancelReason ? JSON.stringify({ reason: cancelReason }) : null,
            },
          })

          if (membershipReversal) {
            await tx.auditLog.create({
              data: {
                clubId: booking.clubId,
                actorUserId: authContext.userId,
                action: 'membership.reversed_on_cancel',
                entityType: 'booking',
                entityId: String(booking.id),
                bookingId: booking.id,
                metadata: JSON.stringify(membershipReversal),
              },
            })
          }
        }

        return { booking, membershipReversal }
      })
      invalidateSeatAvailability(result.booking)

      return NextResponse.json({
        ...result.booking,
        membershipReversal: result.membershipReversal,
      })
    }

    if (action === 'mark_paid') {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { room: true },
      })
      if (!booking) {
        return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
      }

      const baseAmountCents = booking.priceTotalCents ?? booking.room.pricePerNightCents

      if (booking.paymentStatus === PaymentStatus.PAID && booking.invoiceId) {
        return NextResponse.json(booking)
      }

      if (booking.paymentStatus === PaymentStatus.PAID && !booking.orderId) {
        return NextResponse.json(booking)
      }

      if (booking.clubId && booking.clientUserId) {
        const orderId =
          booking.orderId ||
          (
            await prisma.$transaction(async (tx) => {
              const legacyOrder = await tx.order.create({
                data: {
                  orderNumber: `LEGACY-${booking.id}`,
                  userId: booking.clientUserId as string,
                  clubId: booking.clubId as string,
                  status: OrderStatus.AWAITING_OFFLINE_PAYMENT,
                  source: OrderSource.HOST_ASSISTED,
                  currency: booking.priceCurrency || 'KZT',
                  subtotalCents: baseAmountCents,
                  discountTotalCents: 0,
                  taxTotalCents: 0,
                  totalCents: baseAmountCents,
                  pricingSnapshotJson: booking.priceSnapshotJson,
                },
              })

              const orderItem = await tx.orderItem.create({
                data: {
                  orderId: legacyOrder.id,
                  slotId: booking.slotId,
                  seatId: booking.seatId,
                  seatLabelSnapshot: booking.seatLabelSnapshot,
                  roomId: booking.roomId,
                  segmentId: null,
                  startAtUtc: booking.checkIn,
                  endAtUtc: booking.checkOut,
                  quantity: 1,
                  unitPriceCents: baseAmountCents,
                  totalPriceCents: baseAmountCents,
                  priceSnapshotJson: booking.priceSnapshotJson,
                },
              })

              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  orderId: legacyOrder.id,
                  orderItemId: orderItem.id,
                },
              })

              await tx.auditLog.create({
                data: {
                  clubId: booking.clubId,
                  actorUserId: authContext.userId,
                  action: 'order.legacy_linked',
                  entityType: 'order',
                  entityId: legacyOrder.id,
                  bookingId: booking.id,
                  metadata: JSON.stringify({
                    bookingId: booking.id,
                    orderNumber: legacyOrder.orderNumber,
                  }),
                },
              })

              return legacyOrder.id
            })
          )

        try {
          const paid = await markOfflineOrderPaidByStaff({
            orderId,
            actorUserId: authContext.userId,
            reason: 'Manual mark paid from booking operations',
          })

          const refreshed = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: { room: true },
          })
          if (!refreshed) {
            return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
          }

          return NextResponse.json({
            ...refreshed,
            orderId: paid.orderId,
            invoiceId: paid.invoiceId,
          })
        } catch (error) {
          if (error instanceof CommerceError) {
            return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
          }
          return NextResponse.json(
            { error: 'Failed to mark booking as paid through order workflow.' },
            { status: 500 },
          )
        }
      }

      const fallback = await prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PaymentStatus.PAID },
        include: { room: true },
      })

      if (fallback.clubId) {
        await prisma.payment.create({
          data: {
            clubId: fallback.clubId,
            bookingId: fallback.id,
            amountCents: baseAmountCents,
            method: 'OFFLINE_MANUAL',
            status: PaymentStatus.PAID,
            markedByUserId: authContext.userId,
          },
        })

        await prisma.auditLog.create({
          data: {
            clubId: fallback.clubId,
            actorUserId: authContext.userId,
            action: 'payment.marked_paid',
            entityType: 'booking',
            entityId: String(fallback.id),
            bookingId: fallback.id,
            metadata: JSON.stringify({
              fallback: true,
              reason: 'Booking has no client user linkage for order/invoice generation.',
            }),
          },
        })
      }

      return NextResponse.json(fallback)
    }

    if (action === 'check_in') {
      if (existing.status === BookingStatus.CANCELED || existing.status === BookingStatus.COMPLETED) {
        return NextResponse.json(
          { error: 'Cannot check in canceled or completed booking.' },
          { status: 409 },
        )
      }
      if (existing.status === BookingStatus.CHECKED_IN) {
        return NextResponse.json(existing)
      }
      if (existing.status !== BookingStatus.CONFIRMED) {
        return NextResponse.json(
          { error: 'Only confirmed bookings can be checked in.' },
          { status: 409 },
        )
      }
      if (existing.clubId) {
        const club = await prisma.club.findUnique({
          where: { id: existing.clubId },
          select: { checkInPolicyJson: true },
        })
        const allowed = isCheckInAllowed({
          slotStartAt: slotStartAt(existing),
          policyJson: club?.checkInPolicyJson ?? null,
        })
        if (!allowed) {
          return NextResponse.json(
            {
              code: 'POLICY_VIOLATION',
              error: 'Check-in is outside allowed check-in window.',
            },
            { status: 409 },
          )
        }
      }

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          checkedInAt: new Date(),
          checkedInByUserId: authContext.userId,
          status: BookingStatus.CHECKED_IN,
        },
        include: { room: true },
      })
      invalidateSeatAvailability(booking)

      if (booking.clubId) {
        await prisma.auditLog.create({
          data: {
            clubId: booking.clubId,
            actorUserId: authContext.userId,
            action: 'booking.checked_in',
            entityType: 'booking',
            entityId: String(booking.id),
            bookingId: booking.id,
          },
        })
      }

      return NextResponse.json(booking)
    }

    if (action === 'check_out') {
      if (existing.status === BookingStatus.CANCELED || existing.status === BookingStatus.COMPLETED) {
        return NextResponse.json(
          { error: 'Booking is already finalized.' },
          { status: 409 },
        )
      }
      if (
        existing.status !== BookingStatus.CHECKED_IN &&
        existing.status !== BookingStatus.CONFIRMED
      ) {
        return NextResponse.json(
          { error: 'Booking must be confirmed or checked-in before check-out.' },
          { status: 409 },
        )
      }

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          checkedOutAt: new Date(),
          status: BookingStatus.COMPLETED,
        },
        include: { room: true },
      })
      invalidateSeatAvailability(booking)

      if (booking.clubId) {
        await prisma.auditLog.create({
          data: {
            clubId: booking.clubId,
            actorUserId: authContext.userId,
            action: 'booking.checked_out',
            entityType: 'booking',
            entityId: String(booking.id),
            bookingId: booking.id,
          },
        })
      }

      return NextResponse.json(booking)
    }

    if (action === 'move_seat') {
      const newSeatId = typeof body.newSeatId === 'string' ? body.newSeatId.trim() : ''
      if (!newSeatId || !existing.clubId || !existing.slotId) {
        return NextResponse.json(
          { error: 'newSeatId is required for seat-based move.' },
          { status: 400 },
        )
      }
      if (!isOperationalBookingStatus(existing.status)) {
        return NextResponse.json(
          { error: 'Only confirmed or checked-in bookings can be moved.' },
          { status: 409 },
        )
      }
      if (existing.seatId === newSeatId) {
        return NextResponse.json(existing)
      }

      const latestMapVersion = await prisma.seatMapVersion.findFirst({
        where: { clubId: existing.clubId },
        orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
        select: { id: true },
      })
      if (!latestMapVersion) {
        return NextResponse.json({ error: 'No published map version found.' }, { status: 409 })
      }

      const [targetSeat, currentSeat] = await Promise.all([
        prisma.seatIndex.findFirst({
          where: {
            clubId: existing.clubId,
            mapVersionId: latestMapVersion.id,
            seatId: newSeatId,
            isActive: true,
          },
          select: {
            seatId: true,
            label: true,
            segmentId: true,
            isDisabled: true,
            disabledReason: true,
          },
        }),
        existing.seatId
          ? prisma.seatIndex.findFirst({
              where: {
                clubId: existing.clubId,
                mapVersionId: latestMapVersion.id,
                seatId: existing.seatId,
                isActive: true,
              },
              select: {
                seatId: true,
                label: true,
                segmentId: true,
              },
            })
          : Promise.resolve(null),
      ])

      if (!targetSeat) {
        return NextResponse.json({ error: 'Target seat was not found.' }, { status: 404 })
      }
      if (targetSeat.isDisabled) {
        return NextResponse.json(
          {
            code: 'SEAT_NOT_AVAILABLE',
            error: targetSeat.disabledReason
              ? `Seat is disabled: ${targetSeat.disabledReason}`
              : 'Seat is disabled.',
          },
          { status: 409 },
        )
      }

      if (currentSeat && currentSeat.segmentId !== targetSeat.segmentId) {
        return NextResponse.json(
          {
            code: 'SEGMENT_MISMATCH',
            error: 'Cannot move booking to a different segment yet.',
          },
          { status: 409 },
        )
      }

      await expireActiveHolds(prisma, {
        clubId: existing.clubId,
        slotId: existing.slotId,
        seatId: newSeatId,
      })

      const overlappingSeatBooking = await prisma.booking.findFirst({
        where: {
          id: { not: bookingId },
          clubId: existing.clubId,
          slotId: existing.slotId,
          seatId: newSeatId,
          status: { in: [...seatBlockingBookingStatuses()] },
        },
        select: { id: true },
      })
      if (overlappingSeatBooking) {
        return NextResponse.json(
          { error: 'Target seat is not available for this slot.' },
          { status: 409 },
        )
      }

      const booking = await prisma.$transaction(async (tx) => {
        const updated = await tx.booking.update({
          where: { id: bookingId },
          data: {
            seatId: newSeatId,
            seatLabelSnapshot: targetSeat.label,
          },
          include: { room: true },
        })

        await tx.auditLog.create({
          data: {
            clubId: updated.clubId,
            actorUserId: authContext.userId,
            action: 'booking.moved_seat',
            entityType: 'booking',
            entityId: String(updated.id),
            bookingId: updated.id,
            metadata: JSON.stringify({
              slotId: updated.slotId,
              fromSeatId: existing.seatId,
              toSeatId: newSeatId,
              fromSeatLabel: currentSeat?.label ?? null,
              toSeatLabel: targetSeat.label,
            }),
          },
        })

        return updated
      })
      invalidateSeatAvailability(booking)
      return NextResponse.json(booking)
    }

    if (action === 'attach_customer') {
      if (!existing.clubId) {
        return NextResponse.json(
          { error: 'Booking is not associated with a club.' },
          { status: 409 },
        )
      }

      const selectedCustomerId =
        typeof body.customerId === 'string' ? body.customerId.trim() : ''
      if (!selectedCustomerId) {
        return NextResponse.json(
          { error: 'customerId is required for attach_customer action.' },
          { status: 400 },
        )
      }

      const customer = await prisma.customer.findFirst({
        where: {
          id: selectedCustomerId,
          clubId: existing.clubId,
          status: { not: CustomerRecordStatus.DELETED },
        },
        select: {
          id: true,
          phone: true,
        },
      })
      if (!customer) {
        return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
      }

      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          customerId: customer.id,
          guestPhone: customer.phone ?? existing.guestPhone,
        },
        include: { room: true },
      })

      await prisma.auditLog.create({
        data: {
          clubId: existing.clubId,
          actorUserId: authContext.userId,
          action: 'booking.customer_attached',
          entityType: 'booking',
          entityId: String(booking.id),
          bookingId: booking.id,
          metadata: JSON.stringify({
            customerId: customer.id,
          }),
        },
      })

      return NextResponse.json(booking)
    }
  }

  const roomId = Number(body.roomId)
  const guests = Number(body.guests)
  const guestName = body.guestName?.trim()
  const guestEmail = body.guestEmail?.trim().toLowerCase()
  const checkIn = parseIsoDate(body.checkIn || '')
  const checkOut = parseIsoDate(body.checkOut || '')
  const notes = body.notes?.trim() || null
  const parsedStatus = parseStatus(body.status)

  if (body.status !== undefined && !parsedStatus) {
    return NextResponse.json({ error: 'Invalid booking status.' }, { status: 400 })
  }

  const status = parsedStatus ?? existing.status

  if (!roomId || !guestName || !guestEmail || !checkIn || !checkOut || !guests) {
    return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
  }

  if (guests < 1) {
    return NextResponse.json({ error: 'Guests must be greater than zero.' }, { status: 400 })
  }

  if (checkIn >= checkOut) {
    return NextResponse.json(
      { error: 'Check-out must be after check-in.' },
      { status: 400 },
    )
  }

  const room = await prisma.room.findUnique({ where: { id: roomId } })
  if (!room) {
    return NextResponse.json({ error: 'Selected room was not found.' }, { status: 404 })
  }

  if (existing.clubId && room.clubId !== existing.clubId) {
    return NextResponse.json({ error: 'Room must stay within the same club.' }, { status: 400 })
  }

  if (guests > room.capacity) {
    return NextResponse.json(
      { error: `Guest count exceeds room capacity (${room.capacity}).` },
      { status: 400 },
    )
  }

  if (isActiveStatus(status)) {
    const overlapping = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        roomId,
        status: { in: [...activeBookingStatuses()] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
    })

    if (overlapping) {
      return NextResponse.json(
        { error: 'This room is already booked for the selected dates.' },
        { status: 409 },
      )
    }
  }

  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      roomId,
      guestName,
      guestEmail,
      checkIn,
      checkOut,
      guests,
      notes,
      status,
    },
    include: { room: true },
  })
  invalidateSeatAvailability(booking)

  if (booking.clubId) {
    await prisma.auditLog.create({
      data: {
        clubId: booking.clubId,
        actorUserId: authContext.userId,
        action: 'booking.updated',
        entityType: 'booking',
        entityId: String(booking.id),
        bookingId: booking.id,
      },
    })
  }

  return NextResponse.json(booking)
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { id: rawId } = await context.params
  const bookingId = parseBookingId(rawId)

  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  const authContext = await getCabinetContext()
  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      slot: {
        select: {
          startAtUtc: true,
        },
      },
    },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
  }

  const clientOwnsBooking = await canClientAccessBooking(existing, authContext)

  if (!clientOwnsBooking) {
    if (authContext.activeRole === Role.CLIENT) {
      return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })
    }
    try {
      ensureStaffBookingAccess({
        request: _,
        context: authContext,
        bookingClubId: existing.clubId,
        action: 'cancel',
      })
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  if (existing.status === BookingStatus.CANCELED) {
    return NextResponse.json(existing)
  }
  if (existing.clubId) {
    const club = await prisma.club.findUnique({
      where: { id: existing.clubId },
      select: { cancellationPolicyJson: true },
    })
    const allowed = isCancellationAllowed({
      slotStartAt: slotStartAt(existing),
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
        canceledByUserId: authContext.userId,
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
      actorUserId: authContext.userId,
      actorRole:
        authContext.activeRole === Role.CLIENT
          ? MembershipActorRole.CLIENT
          : MembershipActorRole.STAFF,
    })

    if (booking.clubId) {
      await tx.auditLog.create({
        data: {
          clubId: booking.clubId,
          actorUserId: authContext.userId,
          action: 'booking.canceled',
          entityType: 'booking',
          entityId: String(booking.id),
          bookingId: booking.id,
        },
      })

      if (membershipReversal) {
        await tx.auditLog.create({
          data: {
            clubId: booking.clubId,
            actorUserId: authContext.userId,
            action: 'membership.reversed_on_cancel',
            entityType: 'booking',
            entityId: String(booking.id),
            bookingId: booking.id,
            metadata: JSON.stringify(membershipReversal),
          },
        })
      }
    }

    return { booking, membershipReversal }
  })
  invalidateSeatAvailability(result.booking)

  return NextResponse.json({
    ...result.booking,
    membershipReversal: result.membershipReversal,
  })
}
