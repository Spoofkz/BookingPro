import { ChannelType, CustomerType, Role, SlotStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { isPublishedClub } from '@/src/lib/clubLifecycle'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import {
  applyMembershipToQuote,
  MembershipFlowError,
  type MembershipPaymentPreference,
} from '@/src/lib/membershipService'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { generatePriceQuote } from '@/src/lib/pricingEngine'
import { isPricingError, PricingError } from '@/src/lib/pricingErrors'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type QuoteRequestBody = {
  clubId: string
  slotId?: string
  seatId?: string
  roomId?: number
  segmentId?: string
  packageId?: string
  channel?: ChannelType
  customerType?: CustomerType
  promoCode?: string
  startAt?: string
  endAt?: string
  membership?: {
    entitlementId?: string
    useWallet?: boolean
    paymentPreference?: MembershipPaymentPreference
    customerId?: string
  }
}

function parseDate(value: string | undefined | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function parseRoomId(body: QuoteRequestBody) {
  if (body.roomId == null) return undefined
  const parsed = Number(body.roomId)
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

function parsePaymentPreference(value: unknown): MembershipPaymentPreference {
  if (value === 'WALLET_FIRST') return 'WALLET_FIRST'
  if (value === 'CASH') return 'CASH'
  return 'MEMBERSHIP_FIRST'
}

async function resolveSeatContext(clubId: string, seatId: string) {
  const latestMapVersion = await prisma.seatMapVersion.findFirst({
    where: { clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!latestMapVersion) {
    throw new PricingError(
      'SEAT_NOT_FOUND',
      'No published map version found for this club.',
      409,
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
      seatId: true,
      label: true,
      segmentId: true,
      roomId: true,
      isDisabled: true,
      disabledReason: true,
    },
  })
  if (!seat) {
    throw new PricingError('SEAT_NOT_FOUND', 'Seat was not found in published map.', 404)
  }
  if (seat.isDisabled) {
    throw new PricingError(
      'SEAT_DISABLED',
      seat.disabledReason ? `Seat is disabled: ${seat.disabledReason}` : 'Seat is disabled.',
      409,
    )
  }

  return seat
}

async function resolveMembershipScope(params: {
  body: QuoteRequestBody
  clubId: string
  contextUserId: string
  isClient: boolean
}) {
  const membership = params.body.membership
  if (!membership) {
    return {
      userId: null as string | null,
      customerId: null as string | null,
      entitlementId: null as string | null,
      useWallet: false,
      preference: parsePaymentPreference(undefined),
    }
  }

  const entitlementId = membership.entitlementId?.trim() || null
  const useWallet = membership.useWallet === true
  const preference = parsePaymentPreference(membership.paymentPreference)

  if (!entitlementId && !useWallet) {
    return {
      userId: null as string | null,
      customerId: null as string | null,
      entitlementId: null as string | null,
      useWallet: false,
      preference,
    }
  }

  if (params.isClient) {
    return {
      userId: params.contextUserId,
      customerId: null,
      entitlementId,
      useWallet,
      preference,
    }
  }

  const selectedCustomerId = membership.customerId?.trim() || null
  if (!selectedCustomerId && !entitlementId) {
    return {
      userId: null,
      customerId: null,
      entitlementId: null,
      useWallet,
      preference,
    }
  }

  let customerId = selectedCustomerId
  let userId: string | null = null

  if (selectedCustomerId) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: selectedCustomerId,
        clubId: params.clubId,
        status: { not: 'DELETED' },
      },
      select: {
        id: true,
        linkedUserId: true,
      },
    })
    if (!customer) {
      throw new MembershipFlowError('NOT_FOUND', 404, 'Customer was not found.')
    }
    customerId = customer.id
    userId = customer.linkedUserId
  }

  return {
    userId,
    customerId,
    entitlementId,
    useWallet,
    preference,
  }
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()
  const idempotencyKey = readIdempotencyKey(request)

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const requestHash = hashRequestBody(rawBody || '{}')
  let body: QuoteRequestBody = {} as QuoteRequestBody
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as QuoteRequestBody
    } catch {
      return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'Invalid JSON payload.' }, { status: 400 })
    }
  }

  if (!body.clubId?.trim()) {
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: 'clubId is required.' }, { status: 400 })
  }

  const clubId = body.clubId.trim()
  const isStaffMember = context.roles.some((role) => role.clubId === clubId)
  if (!isStaffMember) {
    if (context.activeRole !== Role.CLIENT) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { status: true },
    })
    if (!club || !isPublishedClub(club.status)) {
      return NextResponse.json(
        { code: 'CLUB_NOT_FOUND', error: 'Club is not available for quoting.' },
        { status: 404 },
      )
    }
  }

  if (idempotencyKey) {
    try {
      const replay = await replayIdempotentResponse<Record<string, unknown>>({
        userId: context.userId,
        operation: 'pricing.quote',
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

  const channel =
    body.channel || (context.activeRole === Role.CLIENT ? ChannelType.ONLINE : ChannelType.OFFLINE)

  const customerType = body.customerType || CustomerType.GUEST
  const roomId = parseRoomId(body)

  let startAt = parseDate(body.startAt) || new Date()
  let endAt = parseDate(body.endAt) || new Date(startAt.getTime() + 60 * 60 * 1000)
  let slotMeta: { id: string; startAt: string; endAt: string } | null = null
  if (body.slotId?.trim()) {
    const slot = await prisma.slot.findFirst({
      where: {
        id: body.slotId.trim(),
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
      return NextResponse.json({ code: 'SLOT_NOT_FOUND', error: 'Slot was not found.' }, { status: 404 })
    }
    if (slot.status !== SlotStatus.PUBLISHED) {
      return NextResponse.json(
        { code: 'SLOT_NOT_BOOKABLE', error: 'Slot is not bookable for quote.' },
        { status: 409 },
      )
    }
    startAt = slot.startAtUtc
    endAt = slot.endAtUtc
    slotMeta = {
      id: slot.id,
      startAt: slot.startAtUtc.toISOString(),
      endAt: slot.endAtUtc.toISOString(),
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

  let derivedSegmentId = body.segmentId?.trim() || undefined
  let seatMeta: { seatId: string; label: string; segmentId: string; roomId: string | null } | null = null
  if (body.seatId?.trim()) {
    try {
      const seat = await resolveSeatContext(clubId, body.seatId.trim())
      derivedSegmentId = seat.segmentId
      seatMeta = {
        seatId: seat.seatId,
        label: seat.label,
        segmentId: seat.segmentId,
        roomId: seat.roomId,
      }
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
      throw error
    }
  }

  try {
    const quote = await generatePriceQuote({
      clubId,
      seatId: body.seatId?.trim() || undefined,
      roomId,
      segmentId: derivedSegmentId,
      startAt,
      endAt,
      packageId: body.packageId?.trim() || undefined,
      channel,
      customerType,
      promoCode: body.promoCode,
      promoUserId: context.userId,
      strictPromoCode: false,
      persistQuote: true,
    })

    const membershipScope = await resolveMembershipScope({
      body,
      clubId,
      contextUserId: context.userId,
      isClient: context.activeRole === Role.CLIENT,
    })
    if (membershipScope.entitlementId || membershipScope.useWallet) {
      try {
        assertFeatureEnabled('membership_apply')
      } catch (error) {
        const response = featureErrorResponse(error)
        if (response) return response
        throw error
      }
    }

    let membershipPreview = null as Awaited<ReturnType<typeof applyMembershipToQuote>> | null
    if (membershipScope.entitlementId || membershipScope.useWallet) {
      membershipPreview = await applyMembershipToQuote({
        clubId,
        userId: membershipScope.userId,
        customerId: membershipScope.customerId,
        entitlementId: membershipScope.entitlementId,
        useWallet: membershipScope.useWallet,
        paymentPreference: membershipScope.preference,
        baseTotal: quote.total,
        currency: quote.currency,
        startAt,
        endAt,
        segmentId: seatMeta?.segmentId || derivedSegmentId,
        roomId,
        seatId: seatMeta?.seatId || body.seatId?.trim() || null,
      })
    }

    const responseBody = {
      ...quote,
      baseTotal: quote.total,
      totalDue: membershipPreview ? membershipPreview.remainingDue : quote.total,
      membership: membershipPreview,
      slot: slotMeta,
      seat: seatMeta,
    }

    if (idempotencyKey) {
      await storeIdempotentResponse({
        userId: context.userId,
        operation: 'pricing.quote',
        key: idempotencyKey,
        requestHash,
        statusCode: 200,
        body: responseBody,
      })
    }

    return NextResponse.json(responseBody)
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
    const message = error instanceof Error ? error.message : 'Failed to calculate quote.'
    return NextResponse.json({ code: 'VALIDATION_ERROR', error: message }, { status: 400 })
  }
}
