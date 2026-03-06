import {
  BookingStatus,
  ChannelType,
  CustomerType,
  HoldPurpose,
  HoldStatus,
  PaymentStatus,
  MembershipActorRole,
  Prisma,
  Role,
  SlotStatus,
} from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { expireActiveHolds } from '@/src/lib/availabilityService'
import { activeBookingStatuses, completeElapsedBookings } from '@/src/lib/bookingLifecycle'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { generatePriceQuote } from '@/src/lib/pricingEngine'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { isPricingError } from '@/src/lib/pricingErrors'
import { prisma } from '@/src/lib/prisma'
import { consumePromotionRedemptionForBooking, getPromoDiscountFromBreakdown } from '@/src/lib/promoService'
import { PERMISSIONS } from '@/src/lib/rbac'
import { normalizeCustomerPhone, resolveOrCreateCustomerForBooking } from '@/src/lib/customerManagement'
import { consumeMembershipForBooking, MembershipFlowError } from '@/src/lib/membershipService'

export const dynamic = 'force-dynamic'

type CreateBookingBody = {
  roomId: number
  slotId?: string
  seatId?: string
  guestName: string
  guestEmail: string
  guestPhone?: string
  checkIn: string
  checkOut: string
  guests: number
  notes?: string
  packageId?: string
  promoCode?: string
  channel?: ChannelType
  customerType?: CustomerType
  membership?: {
    entitlementId?: string
    useWallet?: boolean
    paymentPreference?: 'MEMBERSHIP_FIRST' | 'WALLET_FIRST' | 'CASH'
  }
}

function parseIsoDate(input: string) {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date
}

function parseStatus(value: string) {
  if (value === BookingStatus.HELD) return BookingStatus.HELD
  if (value === BookingStatus.PENDING) return BookingStatus.PENDING
  if (value === BookingStatus.CONFIRMED) return BookingStatus.CONFIRMED
  if (value === BookingStatus.CHECKED_IN) return BookingStatus.CHECKED_IN
  if (value === BookingStatus.CANCELED) return BookingStatus.CANCELED
  if (value === BookingStatus.COMPLETED) return BookingStatus.COMPLETED
  if (value === BookingStatus.NO_SHOW) return BookingStatus.NO_SHOW
  return null
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function parseChannel(input: string | undefined, fallback: ChannelType) {
  if (input === ChannelType.ONLINE) return ChannelType.ONLINE
  if (input === ChannelType.OFFLINE) return ChannelType.OFFLINE
  return fallback
}

function parseCustomerType(input: string | undefined, fallback: CustomerType) {
  if (input === CustomerType.GUEST) return CustomerType.GUEST
  if (input === CustomerType.MEMBER) return CustomerType.MEMBER
  return fallback
}

function startOfDay(date: Date) {
  const value = new Date(date)
  value.setUTCHours(0, 0, 0, 0)
  return value
}

export async function GET(request: NextRequest) {
  const context = await getCabinetContext()
  await completeElapsedBookings()
  const searchParams = request.nextUrl.searchParams
  const requestedScope = searchParams.get('scope')
  const scope = requestedScope === 'my' ? 'my' : 'club'

  const where: {
    clubId?: string
    OR?: Array<Record<string, string>>
    status?: { in: BookingStatus[] }
    checkIn?: { gte?: Date; lt?: Date }
    room?: { name?: { contains: string; mode: 'insensitive' } }
  } = {}

  const statuses = searchParams
    .get('status')
    ?.split(',')
    .map((value) => parseStatus(value.trim()))
    .filter((value): value is BookingStatus => Boolean(value))

  if (statuses && statuses.length > 0) {
    where.status = { in: statuses }
  }

  const dateFilter = searchParams.get('date')
  if (dateFilter) {
    const date = parseIsoDate(`${dateFilter}T00:00:00.000Z`)
    if (date) {
      const start = startOfDay(date)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      where.checkIn = { gte: start, lt: end }
    }
  }

  const seatLabel = searchParams.get('seatLabel')?.trim()
  if (seatLabel) {
    where.room = { name: { contains: seatLabel, mode: 'insensitive' } }
  }

  if (scope === 'my' || context.activeRole === Role.CLIENT) {
    const email = context.profile.email?.toLowerCase()
    if (email) {
      where.OR = [{ clientUserId: context.userId }, { guestEmail: email }]
    } else {
      where.OR = [{ clientUserId: context.userId }]
    }
  } else {
    try {
      const clubId = resolveClubContextFromRequest(request, context, { required: true })
      if (!clubId) {
        throw new AuthorizationError(
          'CLUB_CONTEXT_REQUIRED',
          'Active club context is required. Set X-Club-Id header.',
          400,
        )
      }
      requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_READ)
      where.clubId = clubId
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
  const skip = (page - 1) * pageSize

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: { room: true },
      orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: pageSize,
    }),
    prisma.booking.count({ where }),
  ])

  return NextResponse.json({
    items,
    page,
    pageSize,
    total,
  })
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let requestedClubId: string | null = null
  try {
    requestedClubId = resolveClubContextFromRequest(request, context, { required: false })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'No active club selected.' }, { status: 400 })
  }

  if (context.activeRole !== Role.CLIENT && requestedClubId) {
    try {
      requirePermissionInClub(context, requestedClubId, PERMISSIONS.BOOKING_CREATE)
    } catch {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  let body: CreateBookingBody

  try {
    body = (await request.json()) as CreateBookingBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const roomId = Number(body.roomId)
  const guests = Number(body.guests)
  const guestName = body.guestName?.trim()
  const guestEmail = body.guestEmail?.trim().toLowerCase()
  const guestPhoneInput = typeof body.guestPhone === 'string' ? body.guestPhone.trim() : ''
  const checkIn = parseIsoDate(body.checkIn)
  const checkOut = parseIsoDate(body.checkOut)
  const slotId = typeof body.slotId === 'string' && body.slotId.trim() ? body.slotId.trim() : null
  const seatId = typeof body.seatId === 'string' && body.seatId.trim() ? body.seatId.trim() : null
  const notes = body.notes?.trim() || null
  const selectedChannel = parseChannel(
    body.channel,
    context.activeRole === Role.CLIENT ? ChannelType.ONLINE : ChannelType.OFFLINE,
  )
  if (body.promoCode?.trim()) {
    try {
      assertFeatureEnabled('promos')
    } catch (error) {
      const response = featureErrorResponse(error)
      if (response) return response
      throw error
    }
  }
  if (body.promoCode?.trim() && context.activeRole !== Role.CLIENT) {
    try {
      if (!requestedClubId) {
        return NextResponse.json({ error: 'No active club selected.' }, { status: 400 })
      }
      requirePermissionInClub(context, requestedClubId, PERMISSIONS.PROMO_APPLY_OFFLINE)
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }
  const selectedCustomerType = parseCustomerType(body.customerType, CustomerType.GUEST)
  const membershipSelection =
    body.membership && typeof body.membership === 'object'
      ? {
          entitlementId:
            typeof body.membership.entitlementId === 'string'
              ? body.membership.entitlementId.trim()
              : undefined,
          useWallet: body.membership.useWallet === true,
          paymentPreference:
            body.membership.paymentPreference === 'WALLET_FIRST'
              ? ('WALLET_FIRST' as const)
              : body.membership.paymentPreference === 'CASH'
                ? ('CASH' as const)
                : ('MEMBERSHIP_FIRST' as const),
        }
      : undefined
  if (membershipSelection && (membershipSelection.entitlementId || membershipSelection.useWallet)) {
    try {
      assertFeatureEnabled('membership_apply')
    } catch (error) {
      const response = featureErrorResponse(error)
      if (response) return response
      throw error
    }
  }
  const normalizedGuestPhone =
    guestPhoneInput.length > 0 ? normalizeCustomerPhone(guestPhoneInput) : null

  if (guestPhoneInput.length > 0 && !normalizedGuestPhone) {
    return NextResponse.json({ error: 'guestPhone must be a valid phone number.' }, { status: 400 })
  }

  if (!roomId || !guestName || !guestEmail || !guests) {
    return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
  }
  if (!slotId && (!checkIn || !checkOut)) {
    return NextResponse.json(
      { error: 'checkIn and checkOut are required when slotId is not provided.' },
      { status: 400 },
    )
  }

  if (guests < 1) {
    return NextResponse.json({ error: 'Guests must be greater than zero.' }, { status: 400 })
  }

  const room = await prisma.room.findUnique({
    where: { id: roomId },
  })
  if (!room) {
    return NextResponse.json({ error: 'Selected room was not found.' }, { status: 404 })
  }

  if (!room.clubId) {
    return NextResponse.json(
      { error: 'Selected room is not assigned to any club.' },
      { status: 400 },
    )
  }
  const clubId = room.clubId

  if (requestedClubId && clubId !== requestedClubId) {
    return NextResponse.json(
      { error: 'Selected room does not belong to active club context.' },
      { status: 403 },
    )
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      name: true,
      status: true,
      pauseReason: true,
    },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found for selected room.' }, { status: 404 })
  }

  let effectiveCheckIn = checkIn
  let effectiveCheckOut = checkOut

  if (slotId) {
      const slot = await prisma.slot.findFirst({
        where: {
          id: slotId,
          clubId,
        },
      select: {
        id: true,
        startAtUtc: true,
        endAtUtc: true,
        status: true,
      },
    })
    if (!slot) {
      return NextResponse.json({ error: 'Slot was not found for selected club.' }, { status: 404 })
    }
    if (slot.status !== SlotStatus.PUBLISHED) {
      return NextResponse.json({ error: 'Slot is not bookable.' }, { status: 409 })
    }
    effectiveCheckIn = slot.startAtUtc
    effectiveCheckOut = slot.endAtUtc
  }

  if (!effectiveCheckIn || !effectiveCheckOut) {
    return NextResponse.json({ error: 'Booking time is invalid.' }, { status: 400 })
  }
  if (effectiveCheckIn >= effectiveCheckOut) {
    return NextResponse.json({ error: 'Check-out must be after check-in.' }, { status: 400 })
  }

  const clubStatus = normalizeClubStatus(club.status)
  if (clubStatus === CLUB_STATUSES.PAUSED) {
    return NextResponse.json(
      {
        error: club.pauseReason
          ? `Club is paused: ${club.pauseReason}`
          : 'Club is paused and cannot accept new bookings.',
      },
      { status: 409 },
    )
  }

  if (context.activeRole === Role.CLIENT && clubStatus !== CLUB_STATUSES.PUBLISHED) {
    return NextResponse.json(
      { error: 'Club is not available for client booking yet.' },
      { status: 403 },
    )
  }

  if (guests > room.capacity) {
    return NextResponse.json(
      { error: `Guest count exceeds room capacity (${room.capacity}).` },
      { status: 400 },
    )
  }

  const overlapping = await prisma.booking.findFirst({
    where: {
      roomId,
      status: { in: [...activeBookingStatuses()] },
      checkIn: { lt: effectiveCheckOut },
      checkOut: { gt: effectiveCheckIn },
    },
  })

  if (overlapping) {
    return NextResponse.json(
      { error: 'This room is already booked for the selected dates.' },
      { status: 409 },
    )
  }

  if (slotId && seatId) {
    await expireActiveHolds(prisma, {
      clubId,
      slotId,
      seatId,
    })

    const duplicateSeat = await prisma.booking.findFirst({
      where: {
        clubId,
        slotId,
        seatId,
        status: { in: [...activeBookingStatuses()] },
      },
      select: { id: true },
    })
    if (duplicateSeat) {
      return NextResponse.json(
        { error: 'Seat is already taken for the selected slot.' },
        { status: 409 },
      )
    }

    const hold = await prisma.hold.findFirst({
      where: {
        clubId,
        slotId,
        seatId,
        status: HoldStatus.ACTIVE,
        expiresAtUtc: { gt: new Date() },
      },
      select: {
        id: true,
        ownerUserId: true,
        expiresAtUtc: true,
        purpose: true,
      },
      orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
    })
    if (
      hold &&
      (hold.purpose !== HoldPurpose.BOOKING || hold.ownerUserId !== context.userId)
    ) {
      return NextResponse.json(
        {
          code: 'SEAT_NOT_AVAILABLE',
          error: 'Seat is currently held by another user.',
          holdExpiresAt: hold.expiresAtUtc,
        },
        { status: 409 },
      )
    }
  }

  let seatLabelSnapshot: string | null = null
  if (slotId && seatId) {
    const latestMapVersion = await prisma.seatMapVersion.findFirst({
      where: { clubId },
      orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
      select: { id: true },
    })
    if (!latestMapVersion) {
      return NextResponse.json(
        { error: 'No published map version found for this club.' },
        { status: 409 },
      )
    }

    const seat = await prisma.seatIndex.findFirst({
      where: {
        clubId,
        mapVersionId: latestMapVersion.id,
        seatId,
        isActive: true,
      },
      select: {
        label: true,
        isDisabled: true,
        disabledReason: true,
      },
    })
    if (!seat) {
      return NextResponse.json({ error: 'Seat was not found in published map.' }, { status: 404 })
    }
    if (seat.isDisabled) {
      return NextResponse.json(
        {
          code: 'SEAT_NOT_AVAILABLE',
          error: seat.disabledReason ? `Seat is disabled: ${seat.disabledReason}` : 'Seat is disabled.',
        },
        { status: 409 },
      )
    }
    seatLabelSnapshot = seat.label || seatId
  }

  let quote: Awaited<ReturnType<typeof generatePriceQuote>>
  try {
    quote = await generatePriceQuote({
      clubId,
      roomId,
      startAt: effectiveCheckIn,
      endAt: effectiveCheckOut,
      packageId: body.packageId,
      promoCode: body.promoCode,
      channel: selectedChannel,
      customerType: selectedCustomerType,
      persistQuote: true,
    })
  } catch (error) {
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
    const message =
      error instanceof Error ? error.message : 'Failed to calculate booking quote.'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const booking = await prisma.$transaction(async (tx) => {
      const resolvedCustomer = await resolveOrCreateCustomerForBooking(tx, {
        clubId,
        actorUserId: context.userId,
        source: 'booking.create',
        displayName: guestName,
        phone:
          normalizedGuestPhone ||
          (context.activeRole === Role.CLIENT ? context.profile.phone : null),
        email: guestEmail,
        linkedUserId: context.activeRole === Role.CLIENT ? context.userId : null,
      })

      const created = await tx.booking.create({
        data: {
          clubId,
          slotId,
          seatId,
          seatLabelSnapshot,
          customerId: resolvedCustomer.customer?.id ?? null,
          roomId,
          clientUserId: context.activeRole === Role.CLIENT ? context.userId : null,
          createdByUserId: context.userId,
          packageId: quote.package?.id || null,
          pricingVersionId: quote.pricingVersionId,
          quoteId: quote.quoteId,
          guestName,
          guestEmail,
          guestPhone: resolvedCustomer.normalizedPhone,
          checkIn: effectiveCheckIn,
          checkOut: effectiveCheckOut,
          guests,
          notes,
          status: BookingStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PENDING,
          channel: selectedChannel,
          customerType: selectedCustomerType,
          promoCode: body.promoCode?.trim() || null,
          priceTotalCents: quote.total,
          priceCurrency: quote.currency,
          priceSnapshotJson: JSON.stringify(quote.breakdown),
          packageSnapshotJson: quote.package ? JSON.stringify(quote.package) : null,
        },
        include: { room: true },
      })

      const membershipConsumption = await consumeMembershipForBooking({
        tx,
        booking: {
          id: created.id,
          clubId: created.clubId,
          customerId: created.customerId,
          clientUserId: created.clientUserId,
          checkIn: created.checkIn,
          checkOut: created.checkOut,
          priceTotalCents: created.priceTotalCents,
          priceCurrency: created.priceCurrency,
          membershipConsumptionJson: created.membershipConsumptionJson,
        },
        selection: membershipSelection,
        segmentId: room.segmentId,
        roomId: created.roomId,
        seatId: created.seatId,
        actorUserId: context.userId,
        actorRole:
          context.activeRole === Role.CLIENT
            ? MembershipActorRole.CLIENT
            : MembershipActorRole.STAFF,
      })

      await consumePromotionRedemptionForBooking({
        tx,
        bookingId: created.id,
        clubId,
        promotionId: quote.promotion?.id ?? null,
        promoCode: body.promoCode?.trim() || null,
        discountAmountCents: getPromoDiscountFromBreakdown(quote.breakdown),
        userId: created.clientUserId ?? null,
        customerId: created.customerId ?? null,
        actorUserId: context.userId,
      })

      if (slotId && seatId) {
        await tx.hold.updateMany({
          where: {
            clubId,
            slotId,
            seatId,
            status: HoldStatus.ACTIVE,
            purpose: HoldPurpose.BOOKING,
          },
          data: {
            status: HoldStatus.CANCELED,
            canceledAtUtc: new Date(),
            canceledByUserId: context.userId,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'booking.created',
          entityType: 'booking',
          entityId: String(created.id),
          bookingId: created.id,
          metadata: JSON.stringify({
            roomId: created.roomId,
            slotId: created.slotId,
            seatId: created.seatId,
            guests: created.guests,
            customerId: created.customerId,
            membershipApplied: Boolean(membershipConsumption),
          }),
        },
      })

      return {
        booking: created,
        membershipConsumption,
      }
    })

    if (slotId && seatId) {
      invalidateAvailabilityCacheForClubSlot(clubId, slotId)
    }

    return NextResponse.json({
      ...booking.booking,
      membership: booking.membershipConsumption,
      totalDue: booking.membershipConsumption?.remainingDue ?? booking.booking.priceTotalCents,
    }, { status: 201 })
  } catch (error) {
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
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: 'Seat is already taken for the selected slot.' },
        { status: 409 },
      )
    }
    throw error
  }
}
