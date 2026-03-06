import {
  HoldPurpose,
  HoldStatus,
  Prisma,
  Role,
  SlotStatus,
} from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { expireActiveHolds } from '@/src/lib/availabilityService'
import { activeBookingStatuses } from '@/src/lib/bookingLifecycle'
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
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type SeatUnavailableCode = 'BOOKED' | 'HELD'

class SeatUnavailableError extends Error {
  code: SeatUnavailableCode
  holdExpiresAt?: Date
  constructor(code: SeatUnavailableCode, message: string, holdExpiresAt?: Date) {
    super(message)
    this.code = code
    this.holdExpiresAt = holdExpiresAt
  }
}

const HOLD_RATE_LIMIT_COUNT = 10
const HOLD_RATE_LIMIT_WINDOW_MINUTES = 10

function parsePayload(input: unknown): {
  slotId: string
  seatId: string
} | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const slotId = typeof record.slotId === 'string' ? record.slotId.trim() : ''
  const seatId = typeof record.seatId === 'string' ? record.seatId.trim() : ''
  if (!slotId || !seatId) return null
  return { slotId, seatId }
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('holds')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

  const { clubId } = await routeContext.params
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

  const parsed = parsePayload(payload)
  if (!parsed) {
    return NextResponse.json({ error: 'slotId and seatId are required.' }, { status: 400 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      status: true,
      holdTtlMinutes: true,
    },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const isStaffMember = canAccessClub(context, clubId) && context.activeRole !== Role.CLIENT
  if (isStaffMember) {
    try {
      requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_CREATE)
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  } else if (context.activeRole !== Role.CLIENT) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  } else if (normalizeClubStatus(club.status) !== CLUB_STATUSES.PUBLISHED) {
    return NextResponse.json({ error: 'Club is not available for booking.' }, { status: 404 })
  }

  const now = new Date()
  if (context.activeRole === Role.CLIENT) {
    const windowStart = new Date(now.getTime() - HOLD_RATE_LIMIT_WINDOW_MINUTES * 60_000)
    const recentHoldsCount = await prisma.hold.count({
      where: {
        clubId,
        ownerUserId: context.userId,
        purpose: HoldPurpose.BOOKING,
        createdAt: { gte: windowStart },
      },
    })
    if (recentHoldsCount >= HOLD_RATE_LIMIT_COUNT) {
      await prisma.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'hold.rate_limit_triggered',
          entityType: 'hold',
          entityId: parsed.slotId,
          metadata: JSON.stringify({
            recentHoldsCount,
            windowMinutes: HOLD_RATE_LIMIT_WINDOW_MINUTES,
          }),
        },
      })
      return NextResponse.json(
        {
          code: 'HOLD_RATE_LIMITED',
          error: 'Too many seat reservations. Please try again in a few minutes.',
        },
        { status: 429 },
      )
    }
  }

  const idempotencyKey = readIdempotencyKey(request)
  if (idempotencyKey) {
    try {
      const replay = await replayIdempotentResponse<Record<string, unknown>>({
        userId: context.userId,
        operation: 'hold.create',
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

  const slot = await prisma.slot.findFirst({
    where: {
      id: parsed.slotId,
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
    return NextResponse.json({ error: 'Slot was not found.' }, { status: 404 })
  }
  if (slot.status !== SlotStatus.PUBLISHED) {
    return NextResponse.json({ error: 'Slot is not bookable.' }, { status: 409 })
  }
  if (slot.endAtUtc <= now) {
    return NextResponse.json(
      {
        code: 'SLOT_NOT_PUBLISHED',
        error: 'Slot is in the past or no longer bookable.',
      },
      { status: 409 },
    )
  }
  const template = await prisma.scheduleTemplate.findUnique({
    where: { clubId },
    select: { bookingLeadTimeMinutes: true },
  })
  const leadMinutes = template?.bookingLeadTimeMinutes ?? 0
  const leadThreshold = new Date(now.getTime() + leadMinutes * 60_000)
  if (slot.startAtUtc < leadThreshold) {
    return NextResponse.json(
      {
        code: 'SLOT_NOT_PUBLISHED',
        error: 'Slot is inside booking lead-time cutoff.',
      },
      { status: 409 },
    )
  }

  const latestMapVersion = await prisma.seatMapVersion.findFirst({
    where: { clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!latestMapVersion) {
    return NextResponse.json({ error: 'No published map version found.' }, { status: 409 })
  }

  const seat = await prisma.seatIndex.findFirst({
    where: {
      clubId,
      mapVersionId: latestMapVersion.id,
      seatId: parsed.seatId,
      isActive: true,
    },
    select: {
      seatId: true,
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
        error: seat.disabledReason
          ? `Seat is disabled: ${seat.disabledReason}`
          : 'Seat is disabled.',
      },
      { status: 409 },
    )
  }

  const ttlMinutes = Math.max(1, club.holdTtlMinutes ?? 15)
  const expiresAtUtc = new Date(now.getTime() + ttlMinutes * 60_000)

  try {
    const hold = await prisma.$transaction(async (tx) => {
      await expireActiveHolds(tx, {
        clubId,
        slotId: parsed.slotId,
        seatId: parsed.seatId,
        now,
      })

      const activeBooking = await tx.booking.findFirst({
        where: {
          clubId,
          slotId: parsed.slotId,
          seatId: parsed.seatId,
          status: { in: [...activeBookingStatuses()] },
        },
        select: { id: true },
      })
      if (activeBooking) {
        throw new SeatUnavailableError('BOOKED', 'Seat is already booked for this slot.')
      }

      const activeHold = await tx.hold.findFirst({
        where: {
          clubId,
          slotId: parsed.slotId,
          seatId: parsed.seatId,
          status: HoldStatus.ACTIVE,
          expiresAtUtc: { gt: now },
        },
        select: {
          id: true,
          ownerUserId: true,
          expiresAtUtc: true,
          purpose: true,
        },
        orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
      })

      if (activeHold) {
        if (
          activeHold.purpose === HoldPurpose.BOOKING &&
          activeHold.ownerUserId === context.userId
        ) {
          return tx.hold.update({
            where: { id: activeHold.id },
            data: { expiresAtUtc },
            select: {
              id: true,
              slotId: true,
              seatId: true,
              expiresAtUtc: true,
            },
          })
        }
        throw new SeatUnavailableError(
          'HELD',
          'Seat is held by another user.',
          activeHold.expiresAtUtc,
        )
      }

      const created = await tx.hold.create({
        data: {
          clubId,
          slotId: parsed.slotId,
          seatId: parsed.seatId,
          ownerUserId: context.userId,
          purpose: HoldPurpose.BOOKING,
          status: HoldStatus.ACTIVE,
          expiresAtUtc,
        },
        select: {
          id: true,
          slotId: true,
          seatId: true,
          expiresAtUtc: true,
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'hold.created',
          entityType: 'hold',
          entityId: created.id,
          metadata: JSON.stringify({
            slotId: created.slotId,
            seatId: created.seatId,
            expiresAtUtc: created.expiresAtUtc.toISOString(),
          }),
        },
      })

      return created
    })

    invalidateAvailabilityCacheForClubSlot(clubId, parsed.slotId)

    const responsePayload = {
      holdId: hold.id,
      clubId,
      slotId: hold.slotId,
      seatId: hold.seatId,
      status: 'HELD',
      expiresAt: hold.expiresAtUtc,
    }
    if (idempotencyKey) {
      await storeIdempotentResponse({
        userId: context.userId,
        operation: 'hold.create',
        key: idempotencyKey,
        requestHash,
        statusCode: 201,
        body: responsePayload,
      })
    }

    return NextResponse.json(responsePayload, { status: 201 })
  } catch (error) {
    if (error instanceof SeatUnavailableError) {
      return NextResponse.json(
        {
          code: 'SEAT_NOT_AVAILABLE',
          reason: error.code,
          error: error.message,
          ...(error.holdExpiresAt ? { holdExpiresAt: error.holdExpiresAt } : {}),
        },
        { status: 409 },
      )
    }

    if (isUniqueViolation(error)) {
      const currentHold = await prisma.hold.findFirst({
        where: {
          clubId,
          slotId: parsed.slotId,
          seatId: parsed.seatId,
          status: HoldStatus.ACTIVE,
          expiresAtUtc: { gt: now },
        },
        select: { expiresAtUtc: true },
        orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
      })
      return NextResponse.json(
        {
          code: 'SEAT_NOT_AVAILABLE',
          reason: 'HELD',
          error: 'Seat is held by another user.',
          ...(currentHold?.expiresAtUtc ? { holdExpiresAt: currentHold.expiresAtUtc } : {}),
        },
        { status: 409 },
      )
    }

    throw error
  }
}
