import {
  BookingStatus,
  ChannelType,
  CustomerType,
  HoldPurpose,
  HoldStatus,
  MembershipActorRole,
  PaymentStatus,
  Prisma,
  Role,
  SlotStatus,
} from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { expireActiveHolds } from '@/src/lib/availabilityService'
import { seatBlockingBookingStatuses } from '@/src/lib/bookingLifecycle'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { canAccessClub } from '@/src/lib/clubAccess'
import { DEMO_USER_COOKIE, getCabinetContext } from '@/src/lib/cabinetContext'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import { generatePriceQuote } from '@/src/lib/pricingEngine'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { isPricingError } from '@/src/lib/pricingErrors'
import { prisma } from '@/src/lib/prisma'
import { consumePromotionRedemptionForBooking, getPromoDiscountFromBreakdown } from '@/src/lib/promoService'
import { PERMISSIONS } from '@/src/lib/rbac'
import { normalizeCustomerPhone, resolveOrCreateCustomerForBooking } from '@/src/lib/customerManagement'
import { consumeMembershipForBooking, MembershipFlowError } from '@/src/lib/membershipService'
import { resolveOrCreateOperationalRoom } from '@/src/lib/operationalRoom'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; holdId: string }>
}

type ConfirmHoldBody = {
  roomId?: number
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  guests?: number
  notes?: string
  packageId?: string
  promoCode?: string
  channel?: ChannelType
  customerType?: CustomerType
  paymentMode?: 'OFFLINE' | 'ONLINE'
  membership?: {
    entitlementId?: string
    useWallet?: boolean
    paymentPreference?: 'MEMBERSHIP_FIRST' | 'WALLET_FIRST' | 'CASH'
  }
}

class ConfirmError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
  constructor(code: string, status: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function parseBody(input: unknown): ConfirmHoldBody {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const value = input as Record<string, unknown>
  const membershipValue =
    value.membership && typeof value.membership === 'object' && !Array.isArray(value.membership)
      ? (value.membership as Record<string, unknown>)
      : null

  return {
    roomId:
      typeof value.roomId === 'number'
        ? value.roomId
        : typeof value.roomId === 'string' && value.roomId.trim()
          ? Number(value.roomId)
          : undefined,
    guestName: typeof value.guestName === 'string' ? value.guestName.trim() : undefined,
    guestEmail:
      typeof value.guestEmail === 'string' ? value.guestEmail.trim().toLowerCase() : undefined,
    guestPhone: typeof value.guestPhone === 'string' ? value.guestPhone.trim() : undefined,
    guests:
      typeof value.guests === 'number'
        ? value.guests
        : typeof value.guests === 'string' && value.guests.trim()
          ? Number(value.guests)
          : undefined,
    notes: typeof value.notes === 'string' ? value.notes.trim() : undefined,
    packageId: typeof value.packageId === 'string' ? value.packageId.trim() : undefined,
    promoCode: typeof value.promoCode === 'string' ? value.promoCode.trim() : undefined,
    channel: value.channel === ChannelType.OFFLINE ? ChannelType.OFFLINE : ChannelType.ONLINE,
    customerType:
      value.customerType === CustomerType.MEMBER ? CustomerType.MEMBER : CustomerType.GUEST,
    paymentMode: value.paymentMode === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
    membership: membershipValue
      ? {
          entitlementId:
            typeof membershipValue.entitlementId === 'string'
              ? membershipValue.entitlementId.trim()
              : undefined,
          useWallet: membershipValue.useWallet === true,
          paymentPreference:
            membershipValue.paymentPreference === 'WALLET_FIRST'
              ? 'WALLET_FIRST'
              : membershipValue.paymentPreference === 'CASH'
                ? 'CASH'
                : 'MEMBERSHIP_FIRST',
        }
      : undefined,
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function fallbackGuestEmail(userId: string) {
  return `walkin+${userId}@local.invalid`
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('holds')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

  const { clubId, holdId } = await routeContext.params
  const context = await getCabinetContext().catch(() => null)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }
  const hasDemoIdentity = Boolean(request.cookies.get(DEMO_USER_COOKIE)?.value)
  if (context.authMethod !== 'session' && (context.activeRole === Role.CLIENT || !hasDemoIdentity)) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const requestHash = hashRequestBody(rawBody || '{}')
  let payload: unknown = {}
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as unknown
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
  }
  const body = parseBody(payload)
  const normalizedGuestPhone =
    typeof body.guestPhone === 'string' && body.guestPhone.length > 0
      ? normalizeCustomerPhone(body.guestPhone)
      : null
  if (body.membership && (body.membership.entitlementId || body.membership.useWallet)) {
    try {
      assertFeatureEnabled('membership_apply')
    } catch (error) {
      const response = featureErrorResponse(error)
      if (response) return response
      throw error
    }
  }
  if (body.promoCode?.trim()) {
    try {
      assertFeatureEnabled('promos')
    } catch (error) {
      const response = featureErrorResponse(error)
      if (response) return response
      throw error
    }
  }
  if (body.guestPhone && !normalizedGuestPhone) {
    return NextResponse.json({ error: 'guestPhone must be a valid phone number.' }, { status: 400 })
  }

  const hold = await prisma.hold.findFirst({
    where: {
      id: holdId,
      clubId,
      purpose: HoldPurpose.BOOKING,
    },
    select: {
      id: true,
      clubId: true,
      slotId: true,
      seatId: true,
      ownerUserId: true,
      status: true,
      expiresAtUtc: true,
    },
  })
  if (!hold) {
    return NextResponse.json({ error: 'Hold was not found.' }, { status: 404 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const isStaffMember = canAccessClub(context, clubId) && context.activeRole !== Role.CLIENT
  if (isStaffMember) {
    try {
      requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_CREATE)
      if (body.promoCode?.trim()) {
        requirePermissionInClub(context, clubId, PERMISSIONS.PROMO_APPLY_OFFLINE)
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  } else {
    if (context.activeRole !== Role.CLIENT) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
    if (normalizeClubStatus(club.status) !== CLUB_STATUSES.PUBLISHED) {
      return NextResponse.json({ error: 'Club is not available for booking.' }, { status: 404 })
    }
    if (hold.ownerUserId !== context.userId) {
      return NextResponse.json({ error: 'Hold was not found.' }, { status: 404 })
    }
  }

  const idempotencyKey = readIdempotencyKey(request)
  if (idempotencyKey) {
    try {
      const replay = await replayIdempotentResponse<Record<string, unknown>>({
        userId: context.userId,
        operation: 'hold.confirm',
        key: idempotencyKey,
        requestHash,
      })
      if (replay) {
        return NextResponse.json(replay.body, { status: replay.statusCode })
      }
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return NextResponse.json(
          {
            code: 'IDEMPOTENCY_KEY_REUSED',
            error: error.message,
          },
          { status: 409 },
        )
      }
      throw error
    }
  }

  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      await expireActiveHolds(tx, {
        clubId,
        slotId: hold.slotId,
        seatId: hold.seatId,
        now,
      })

      const currentHold = await tx.hold.findUnique({
        where: { id: hold.id },
        select: {
          id: true,
          slotId: true,
          seatId: true,
          purpose: true,
          ownerUserId: true,
          status: true,
          expiresAtUtc: true,
        },
      })
      if (!currentHold) {
        throw new ConfirmError('HOLD_NOT_FOUND', 404, 'Hold was not found.')
      }
      if (currentHold.status !== HoldStatus.ACTIVE) {
        if (currentHold.status === HoldStatus.EXPIRED) {
          throw new ConfirmError('HOLD_EXPIRED', 409, 'Hold expired.')
        }
        throw new ConfirmError('HOLD_NOT_ACTIVE', 409, 'Hold is not active.')
      }
      if (currentHold.purpose !== HoldPurpose.BOOKING) {
        throw new ConfirmError('HOLD_NOT_ACTIVE', 409, 'Hold is not usable for booking confirmation.')
      }
      if (currentHold.expiresAtUtc <= now) {
        await tx.hold.update({
          where: { id: currentHold.id },
          data: { status: HoldStatus.EXPIRED },
        })
        throw new ConfirmError('HOLD_EXPIRED', 409, 'Hold expired.')
      }

      const slot = await tx.slot.findFirst({
        where: {
          id: currentHold.slotId,
          clubId,
        },
        select: {
          id: true,
          status: true,
          startAtUtc: true,
          endAtUtc: true,
        },
      })
      if (!slot) {
        throw new ConfirmError('SLOT_NOT_FOUND', 404, 'Slot was not found.')
      }
      if (slot.status !== SlotStatus.PUBLISHED || slot.endAtUtc <= now) {
        throw new ConfirmError(
          'SLOT_NOT_PUBLISHED',
          409,
          'Slot is not bookable.',
        )
      }

      const latestMapVersion = await tx.seatMapVersion.findFirst({
        where: { clubId },
        orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
        select: { id: true },
      })
      if (!latestMapVersion) {
        throw new ConfirmError(
          'SEAT_NOT_AVAILABLE',
          409,
          'No published map version found.',
        )
      }

      const seat = await tx.seatIndex.findFirst({
        where: {
          clubId,
          mapVersionId: latestMapVersion.id,
          seatId: currentHold.seatId,
          isActive: true,
        },
        select: {
          seatId: true,
          segmentId: true,
          label: true,
          isDisabled: true,
          disabledReason: true,
        },
      })
      if (!seat) {
        throw new ConfirmError('SEAT_NOT_AVAILABLE', 409, 'Seat was not found.')
      }
      if (seat.isDisabled) {
        throw new ConfirmError(
          'SEAT_NOT_AVAILABLE',
          409,
          seat.disabledReason
            ? `Seat is disabled: ${seat.disabledReason}`
            : 'Seat is disabled.',
        )
      }

      const conflict = await tx.booking.findFirst({
        where: {
          clubId,
          slotId: currentHold.slotId,
          seatId: currentHold.seatId,
          status: { in: [...seatBlockingBookingStatuses()] },
        },
        select: { id: true },
      })
      if (conflict) {
        throw new ConfirmError(
          'SEAT_NOT_AVAILABLE',
          409,
          'Seat is already booked for this slot.',
        )
      }

      const room = await resolveOrCreateOperationalRoom({
        tx,
        clubId,
        preferredRoomId:
          body.roomId && Number.isInteger(body.roomId) && body.roomId > 0
            ? body.roomId
            : null,
        seatSegmentId: seat.segmentId,
      })

      const guests = Number.isInteger(body.guests) && (body.guests as number) > 0 ? (body.guests as number) : 1
      const guestName = body.guestName || context.profile.name || 'Guest'
      const guestEmail = body.guestEmail || context.profile.email || fallbackGuestEmail(context.userId)
      const customerPhone =
        normalizedGuestPhone || (context.activeRole === Role.CLIENT ? context.profile.phone : null)

      const resolvedCustomer = await resolveOrCreateCustomerForBooking(tx, {
        clubId,
        actorUserId: context.userId,
        source: 'hold.confirm',
        displayName: guestName,
        phone: customerPhone,
        email: guestEmail,
        linkedUserId: context.activeRole === Role.CLIENT ? context.userId : null,
      })

      const quote = await generatePriceQuote({
        clubId,
        roomId: room.id,
        segmentId: seat.segmentId,
        startAt: slot.startAtUtc,
        endAt: slot.endAtUtc,
        packageId: body.packageId,
        promoCode: body.promoCode,
        channel: body.channel ?? (context.activeRole === Role.CLIENT ? ChannelType.ONLINE : ChannelType.OFFLINE),
        customerType: body.customerType ?? CustomerType.GUEST,
        persistQuote: true,
      })

      const booking = await tx.booking.create({
        data: {
          clubId,
          slotId: currentHold.slotId,
          seatId: currentHold.seatId,
          seatLabelSnapshot: seat.label,
          customerId: resolvedCustomer.customer?.id ?? null,
          roomId: room.id,
          clientUserId: currentHold.ownerUserId ?? (context.activeRole === Role.CLIENT ? context.userId : null),
          createdByUserId: context.userId,
          packageId: quote.package?.id || null,
          pricingVersionId: quote.pricingVersionId,
          quoteId: quote.quoteId,
          guestName,
          guestEmail,
          guestPhone: resolvedCustomer.normalizedPhone,
          checkIn: slot.startAtUtc,
          checkOut: slot.endAtUtc,
          guests,
          notes: body.notes || null,
          status: BookingStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PENDING,
          channel: body.channel ?? (context.activeRole === Role.CLIENT ? ChannelType.ONLINE : ChannelType.OFFLINE),
          customerType: body.customerType ?? CustomerType.GUEST,
          promoCode: body.promoCode || null,
          priceTotalCents: quote.total,
          priceCurrency: quote.currency,
          priceSnapshotJson: JSON.stringify(quote.breakdown),
          packageSnapshotJson: quote.package ? JSON.stringify(quote.package) : null,
        },
        select: {
          id: true,
          clubId: true,
          slotId: true,
          seatId: true,
          roomId: true,
          customerId: true,
          clientUserId: true,
          status: true,
          paymentStatus: true,
          checkIn: true,
          checkOut: true,
          priceTotalCents: true,
          priceCurrency: true,
          membershipConsumptionJson: true,
        },
      })

      const membershipConsumption = await consumeMembershipForBooking({
        tx,
        booking,
        selection: body.membership,
        segmentId: seat.segmentId,
        roomId: room.id,
        seatId: currentHold.seatId,
        actorUserId: context.userId,
        actorRole:
          context.activeRole === Role.CLIENT
            ? MembershipActorRole.CLIENT
            : MembershipActorRole.STAFF,
      })

      await consumePromotionRedemptionForBooking({
        tx,
        bookingId: booking.id,
        clubId,
        promotionId: quote.promotion?.id ?? null,
        promoCode: body.promoCode?.trim() || null,
        discountAmountCents: getPromoDiscountFromBreakdown(quote.breakdown),
        userId: booking.clientUserId ?? null,
        customerId: booking.customerId ?? null,
        actorUserId: context.userId,
      })

      await tx.hold.update({
        where: { id: currentHold.id },
        data: {
          status: HoldStatus.CONVERTED,
          canceledAtUtc: now,
          canceledByUserId: context.userId,
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'hold.confirmed',
          entityType: 'hold',
          entityId: currentHold.id,
          metadata: JSON.stringify({
            slotId: currentHold.slotId,
            seatId: currentHold.seatId,
            bookingId: booking.id,
          }),
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'booking.created_from_hold',
          entityType: 'booking',
          entityId: String(booking.id),
          bookingId: booking.id,
          metadata: JSON.stringify({
            holdId: currentHold.id,
            slotId: booking.slotId,
            seatId: booking.seatId,
            customerId: booking.customerId,
            membershipApplied: Boolean(membershipConsumption),
          }),
        },
      })

      return { booking, membershipConsumption }
    })

    invalidateAvailabilityCacheForClubSlot(clubId, hold.slotId)
    const responsePayload = {
      bookingId: result.booking.id,
      status: result.booking.status,
      paymentStatus: result.booking.paymentStatus,
      slotId: result.booking.slotId,
      seatId: result.booking.seatId,
      checkIn: result.booking.checkIn,
      checkOut: result.booking.checkOut,
      membership: result.membershipConsumption,
      totalDue: result.membershipConsumption?.remainingDue ?? result.booking.priceTotalCents,
    }
    if (idempotencyKey) {
      await storeIdempotentResponse({
        userId: context.userId,
        operation: 'hold.confirm',
        key: idempotencyKey,
        requestHash,
        statusCode: 201,
        body: responsePayload,
      })
    }
    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    if (error instanceof ConfirmError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status },
      )
    }
    if (isPricingError(error)) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          details: error.details,
        },
        { status: error.statusCode },
      )
    }
    if (error instanceof MembershipFlowError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status },
      )
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          code: 'SEAT_NOT_AVAILABLE',
          error: 'Seat is already booked for this slot.',
        },
        { status: 409 },
      )
    }
    throw error
  }
}
