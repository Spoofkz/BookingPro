import {
  BookingStatus,
  ChannelType,
  CustomerType,
  HoldPurpose,
  HoldStatus,
  PaymentStatus,
  Prisma,
  RescheduleActorRole,
  RescheduleIntentStatus,
  ReschedulePaymentStatus,
  RescheduleRequiredAction,
  RescheduleSettlementStatus,
  SlotStatus,
  type PrismaClient,
} from '@prisma/client'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { expireActiveHolds } from '@/src/lib/availabilityService'
import { resolveReschedulePolicy, type ReschedulePolicy } from '@/src/lib/bookingPolicies'
import { seatBlockingBookingStatuses } from '@/src/lib/bookingLifecycle'
import { generatePriceQuote } from '@/src/lib/pricingEngine'
import { prisma } from '@/src/lib/prisma'

type DbClient = PrismaClient | Prisma.TransactionClient

export type RescheduleMode = 'CLIENT' | 'STAFF'
export type ReschedulePayMode = 'ONLINE' | 'OFFLINE' | 'NONE'

type BookingForReschedule = {
  id: number
  clubId: string | null
  slotId: string | null
  seatId: string | null
  roomId: number
  packageId: string | null
  pricingVersionId: string | null
  quoteId: string | null
  checkIn: Date
  checkOut: Date
  status: BookingStatus
  channel: ChannelType
  customerType: CustomerType
  priceTotalCents: number | null
  priceCurrency: string | null
  paymentStatus: PaymentStatus
  priceSnapshotJson: string | null
  packageSnapshotJson: string | null
  rescheduleCount: number
  room: {
    id: number
    clubId: string | null
    segmentId: string | null
  }
  slot: {
    id: string
    startAtUtc: Date
    endAtUtc: Date
    status: SlotStatus
  } | null
}

type RescheduleEligibilityDecision = {
  eligible: boolean
  code: string | null
  error: string | null
  policyOverrideUsed: boolean
}

type QuoteSnapshot = {
  quoteId?: string
  currency?: string
  pricingVersionId?: string
  total?: number
  breakdown?: unknown
  package?: unknown
}

type TargetResolution = {
  slotId: string
  seatId: string
  seatLabel: string | null
  roomId: number
  slotStartAt: Date
  slotEndAt: Date
  segmentId: string
}

type CreateIntentResult = {
  rescheduleId: string
  expiresAt: Date
  oldTotal: number
  newTotal: number
  delta: number
  requiredAction: RescheduleRequiredAction
  newQuote: QuoteSnapshot
  policyOverrideUsed: boolean
}

type ConfirmIntentResult = {
  bookingId: number
  status: BookingStatus
  slotId: string | null
  seatId: string | null
  checkIn: Date
  checkOut: Date
  delta: number
  settlementStatus: RescheduleSettlementStatus
}

type IntentPublicView = {
  rescheduleId: string
  bookingId: number
  clubId: string
  status: RescheduleIntentStatus
  expiresAt: Date
  oldTotal: number
  newTotal: number
  delta: number
  requiredAction: RescheduleRequiredAction
  paymentStatus: ReschedulePaymentStatus
  settlementStatus: RescheduleSettlementStatus
  oldSlotId: string | null
  oldSeatId: string | null
  newSlotId: string
  newSeatId: string
  createdByRole: RescheduleActorRole
  createdByUserId: string
  reason: string | null
  policyOverrideUsed: boolean
  createdAt: Date
  updatedAt: Date
  confirmedAt: Date | null
  canceledAt: Date | null
  newQuote: QuoteSnapshot
}

export class RescheduleFlowError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(
    code: string,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

function normalizeReason(input: string | null | undefined) {
  if (typeof input !== 'string') return null
  const normalized = input.trim()
  if (!normalized) return null
  return normalized.slice(0, 500)
}

function asQuoteSnapshot(value: string): QuoteSnapshot {
  try {
    return JSON.parse(value) as QuoteSnapshot
  } catch {
    return {}
  }
}

function oldSlotStartAt(booking: BookingForReschedule) {
  return booking.slot?.startAtUtc ?? booking.checkIn
}

function oldSlotEndAt(booking: BookingForReschedule) {
  return booking.slot?.endAtUtc ?? booking.checkOut
}

function ensureBookingReschedulableStatus(status: BookingStatus) {
  return status === BookingStatus.CONFIRMED || status === BookingStatus.CHECKED_IN
}

function evaluateEligibility(params: {
  mode: RescheduleMode
  policy: ReschedulePolicy
  booking: BookingForReschedule
  now: Date
  allowStaffOverride: boolean
}) {
  const { mode, policy, booking, now, allowStaffOverride } = params
  let policyOverrideUsed = false
  const slotStart = oldSlotStartAt(booking)

  const disallow = (code: string, error: string): RescheduleEligibilityDecision => ({
    eligible: false,
    code,
    error,
    policyOverrideUsed,
  })

  if (!ensureBookingReschedulableStatus(booking.status)) {
    return disallow(
      'BOOKING_NOT_RESCHEDULABLE',
      'Only confirmed or checked-in bookings can be rescheduled.',
    )
  }

  if (!policy.rescheduleEnabled) {
    if (mode === 'STAFF' && allowStaffOverride) {
      policyOverrideUsed = true
    } else {
      return disallow(
        'RESCHEDULE_NOT_ALLOWED_POLICY',
        'Reschedule is disabled by club policy.',
      )
    }
  }

  if (!policy.allowRescheduleAfterStart && now >= slotStart) {
    if (mode === 'STAFF' && allowStaffOverride) {
      policyOverrideUsed = true
    } else {
      return disallow(
        'RESCHEDULE_NOT_ALLOWED_POLICY',
        'Reschedule is not allowed after booking start.',
      )
    }
  }

  if (policy.rescheduleCutoffMinutesBeforeStart > 0) {
    const cutoffBoundary = new Date(
      slotStart.getTime() - policy.rescheduleCutoffMinutesBeforeStart * 60_000,
    )
    if (now > cutoffBoundary) {
      if (mode === 'STAFF' && allowStaffOverride) {
        policyOverrideUsed = true
      } else {
        return disallow(
          'RESCHEDULE_NOT_ALLOWED_POLICY',
          `Reschedule is available until ${policy.rescheduleCutoffMinutesBeforeStart} minutes before start.`,
        )
      }
    }
  }

  if (booking.rescheduleCount >= policy.maxReschedulesPerBooking) {
    if (mode === 'STAFF' && allowStaffOverride) {
      policyOverrideUsed = true
    } else {
      return disallow(
        'RESCHEDULE_NOT_ALLOWED_POLICY',
        `Maximum ${policy.maxReschedulesPerBooking} reschedules reached for this booking.`,
      )
    }
  }

  return {
    eligible: true,
    code: null,
    error: null,
    policyOverrideUsed,
  } satisfies RescheduleEligibilityDecision
}

async function expireStaleRescheduleIntents(
  tx: Prisma.TransactionClient,
  params: {
    clubId: string
    bookingId?: number
    now: Date
  },
) {
  const stale = await tx.rescheduleIntent.findMany({
    where: {
      clubId: params.clubId,
      bookingId: params.bookingId,
      status: RescheduleIntentStatus.ACTIVE,
      expiresAtUtc: { lte: params.now },
    },
    select: {
      id: true,
      lockHoldId: true,
      newSlotId: true,
    },
  })
  if (stale.length === 0) return []

  const staleIds = stale.map((item) => item.id)
  const staleLockIds = stale
    .map((item) => item.lockHoldId)
    .filter((item): item is string => Boolean(item))

  await tx.rescheduleIntent.updateMany({
    where: { id: { in: staleIds } },
    data: {
      status: RescheduleIntentStatus.EXPIRED,
    },
  })

  if (staleLockIds.length > 0) {
    await tx.hold.updateMany({
      where: {
        id: { in: staleLockIds },
        status: HoldStatus.ACTIVE,
      },
      data: {
        status: HoldStatus.EXPIRED,
      },
    })
  }

  return stale.map((item) => item.newSlotId)
}

async function loadBookingForReschedule(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: number
    clubId: string
  },
) {
  const booking = await tx.booking.findFirst({
    where: {
      id: params.bookingId,
      clubId: params.clubId,
    },
    select: {
      id: true,
      clubId: true,
      slotId: true,
      seatId: true,
      roomId: true,
      packageId: true,
      pricingVersionId: true,
      quoteId: true,
      checkIn: true,
      checkOut: true,
      status: true,
      channel: true,
      customerType: true,
      priceTotalCents: true,
      priceCurrency: true,
      paymentStatus: true,
      priceSnapshotJson: true,
      packageSnapshotJson: true,
      rescheduleCount: true,
      room: {
        select: {
          id: true,
          clubId: true,
          segmentId: true,
        },
      },
      slot: {
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          status: true,
        },
      },
    },
  })
  if (!booking) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Booking was not found.')
  }
  if (!booking.clubId) {
    throw new RescheduleFlowError(
      'BOOKING_NOT_RESCHEDULABLE',
      409,
      'Booking is not associated with a club.',
    )
  }

  return booking satisfies BookingForReschedule
}

async function resolveTarget(
  tx: Prisma.TransactionClient,
  params: {
    clubId: string
    booking: BookingForReschedule
    newSlotId: string
    newSeatId?: string | null
    now: Date
  },
) {
  const slot = await tx.slot.findFirst({
    where: {
      id: params.newSlotId,
      clubId: params.clubId,
    },
    select: {
      id: true,
      startAtUtc: true,
      endAtUtc: true,
      status: true,
    },
  })
  if (!slot) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Target slot was not found.')
  }
  if (slot.status !== SlotStatus.PUBLISHED || slot.endAtUtc <= params.now) {
    throw new RescheduleFlowError(
      'TARGET_NOT_AVAILABLE',
      409,
      'Target slot is not bookable.',
    )
  }

  const targetSeatId = params.newSeatId?.trim() || params.booking.seatId || ''
  if (!targetSeatId) {
    throw new RescheduleFlowError(
      'VALIDATION_ERROR',
      400,
      'newSeatId is required when booking does not have a seat.',
    )
  }

  const mapVersion = await tx.seatMapVersion.findFirst({
    where: { clubId: params.clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!mapVersion) {
    throw new RescheduleFlowError(
      'TARGET_NOT_AVAILABLE',
      409,
      'No published map version found for target club.',
    )
  }

  const seat = await tx.seatIndex.findFirst({
    where: {
      clubId: params.clubId,
      mapVersionId: mapVersion.id,
      seatId: targetSeatId,
      isActive: true,
    },
    select: {
      seatId: true,
      label: true,
      segmentId: true,
      isDisabled: true,
      disabledReason: true,
    },
  })
  if (!seat) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Target seat was not found.')
  }
  if (seat.isDisabled) {
    throw new RescheduleFlowError(
      'TARGET_NOT_AVAILABLE',
      409,
      seat.disabledReason ? `Seat is disabled: ${seat.disabledReason}` : 'Seat is disabled.',
    )
  }

  let targetRoom: { id: number } | null = null
  if (params.booking.room.clubId === params.clubId && params.booking.room.segmentId === seat.segmentId) {
    targetRoom = { id: params.booking.room.id }
  }
  if (!targetRoom) {
    targetRoom = await tx.room.findFirst({
      where: {
        clubId: params.clubId,
        segmentId: seat.segmentId,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
  }
  if (!targetRoom) {
    targetRoom = await tx.room.findFirst({
      where: {
        clubId: params.clubId,
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    })
  }
  if (!targetRoom) {
    throw new RescheduleFlowError(
      'TARGET_NOT_AVAILABLE',
      409,
      'No operational room is available for target seat/segment.',
    )
  }

  return {
    slotId: slot.id,
    seatId: targetSeatId,
    seatLabel: seat.label || seat.seatId,
    roomId: targetRoom.id,
    slotStartAt: slot.startAtUtc,
    slotEndAt: slot.endAtUtc,
    segmentId: seat.segmentId,
  } satisfies TargetResolution
}

function computeRequiredAction(params: {
  delta: number
  mode: RescheduleMode
  policy: ReschedulePolicy
}) {
  if (params.delta > 0) return RescheduleRequiredAction.PAY_EXTRA
  if (params.delta === 0) return RescheduleRequiredAction.NONE
  if (params.mode === 'CLIENT' && !params.policy.allowClientNegativeDelta) {
    return RescheduleRequiredAction.BLOCKED
  }
  return RescheduleRequiredAction.REFUND_OR_CREDIT
}

function serializeIntent(intent: {
  id: string
  bookingId: number
  clubId: string
  status: RescheduleIntentStatus
  expiresAtUtc: Date
  oldPriceTotal: number
  newPriceTotal: number
  delta: number
  requiredAction: RescheduleRequiredAction
  paymentStatus: ReschedulePaymentStatus
  settlementStatus: RescheduleSettlementStatus
  oldSlotId: string | null
  oldSeatId: string | null
  newSlotId: string
  newSeatId: string
  createdByRole: RescheduleActorRole
  createdByUserId: string
  reason: string | null
  policyOverrideUsed: boolean
  createdAt: Date
  updatedAt: Date
  confirmedAt: Date | null
  canceledAt: Date | null
  newQuoteSnapshotJson: string
}) {
  return {
    rescheduleId: intent.id,
    bookingId: intent.bookingId,
    clubId: intent.clubId,
    status: intent.status,
    expiresAt: intent.expiresAtUtc,
    oldTotal: intent.oldPriceTotal,
    newTotal: intent.newPriceTotal,
    delta: intent.delta,
    requiredAction: intent.requiredAction,
    paymentStatus: intent.paymentStatus,
    settlementStatus: intent.settlementStatus,
    oldSlotId: intent.oldSlotId,
    oldSeatId: intent.oldSeatId,
    newSlotId: intent.newSlotId,
    newSeatId: intent.newSeatId,
    createdByRole: intent.createdByRole,
    createdByUserId: intent.createdByUserId,
    reason: intent.reason,
    policyOverrideUsed: intent.policyOverrideUsed,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    confirmedAt: intent.confirmedAt,
    canceledAt: intent.canceledAt,
    newQuote: asQuoteSnapshot(intent.newQuoteSnapshotJson),
  } satisfies IntentPublicView
}

export async function getRescheduleEligibility(params: {
  bookingId: number
  clubId: string
  mode: RescheduleMode
  allowStaffOverride?: boolean
  now?: Date
}) {
  const now = params.now ?? new Date()
  const booking = await prisma.booking.findFirst({
    where: {
      id: params.bookingId,
      clubId: params.clubId,
    },
    select: {
      id: true,
      clubId: true,
      slotId: true,
      seatId: true,
      roomId: true,
      packageId: true,
      pricingVersionId: true,
      quoteId: true,
      checkIn: true,
      checkOut: true,
      status: true,
      channel: true,
      customerType: true,
      priceTotalCents: true,
      priceCurrency: true,
      paymentStatus: true,
      priceSnapshotJson: true,
      packageSnapshotJson: true,
      rescheduleCount: true,
      room: {
        select: {
          id: true,
          clubId: true,
          segmentId: true,
        },
      },
      slot: {
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          status: true,
        },
      },
    },
  })
  if (!booking) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Booking was not found.')
  }

  const club = await prisma.club.findUnique({
    where: { id: params.clubId },
    select: { id: true, reschedulePolicyJson: true },
  })
  if (!club) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Club was not found.')
  }

  const policy = resolveReschedulePolicy(club.reschedulePolicyJson)
  const decision = evaluateEligibility({
    mode: params.mode,
    policy,
    booking: booking satisfies BookingForReschedule,
    now,
    allowStaffOverride: params.allowStaffOverride ?? false,
  })

  return {
    eligible: decision.eligible,
    code: decision.code,
    error: decision.error,
    policyOverrideUsed: decision.policyOverrideUsed,
    rescheduleCount: booking.rescheduleCount,
    maxReschedulesPerBooking: policy.maxReschedulesPerBooking,
    cutoffMinutesBeforeStart: policy.rescheduleCutoffMinutesBeforeStart,
    allowRescheduleAfterStart: policy.allowRescheduleAfterStart,
    oldSlotStartAt: oldSlotStartAt(booking),
    oldSlotEndAt: oldSlotEndAt(booking),
  }
}

export async function createRescheduleIntent(params: {
  bookingId: number
  clubId: string
  mode: RescheduleMode
  actorUserId: string
  newSlotId: string
  newSeatId?: string | null
  packageId?: string | null
  reason?: string | null
  allowStaffOverride?: boolean
  now?: Date
}) {
  const now = params.now ?? new Date()
  const reason = normalizeReason(params.reason)

  const result = await prisma.$transaction(async (tx) => {
    const booking = await loadBookingForReschedule(tx, {
      bookingId: params.bookingId,
      clubId: params.clubId,
    })
    const club = await tx.club.findUnique({
      where: { id: params.clubId },
      select: { id: true, reschedulePolicyJson: true },
    })
    if (!club) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Club was not found.')
    }

    await expireStaleRescheduleIntents(tx, {
      clubId: params.clubId,
      bookingId: booking.id,
      now,
    })

    const activeIntent = await tx.rescheduleIntent.findFirst({
      where: {
        clubId: params.clubId,
        bookingId: booking.id,
        status: RescheduleIntentStatus.ACTIVE,
        expiresAtUtc: { gt: now },
      },
      select: { id: true },
    })
    if (activeIntent) {
      throw new RescheduleFlowError(
        'RESCHEDULE_ALREADY_IN_PROGRESS',
        409,
        'An active reschedule intent already exists for this booking.',
      )
    }

    const policy = resolveReschedulePolicy(club.reschedulePolicyJson)
    const eligibility = evaluateEligibility({
      mode: params.mode,
      policy,
      booking,
      now,
      allowStaffOverride: params.allowStaffOverride ?? false,
    })
    if (!eligibility.eligible) {
      throw new RescheduleFlowError(
        eligibility.code || 'RESCHEDULE_NOT_ALLOWED_POLICY',
        409,
        eligibility.error || 'Reschedule is not allowed by policy.',
      )
    }

    const target = await resolveTarget(tx, {
      clubId: params.clubId,
      booking,
      newSlotId: params.newSlotId,
      newSeatId: params.newSeatId,
      now,
    })

    if (booking.slotId === target.slotId && booking.seatId === target.seatId) {
      throw new RescheduleFlowError(
        'VALIDATION_ERROR',
        400,
        'Target slot/seat is the same as current booking.',
      )
    }

    await expireActiveHolds(tx, {
      clubId: params.clubId,
      slotId: target.slotId,
      seatId: target.seatId,
      now,
    })

    const blockingBooking = await tx.booking.findFirst({
      where: {
        id: { not: booking.id },
        clubId: params.clubId,
        slotId: target.slotId,
        seatId: target.seatId,
        status: { in: [...seatBlockingBookingStatuses()] },
      },
      select: { id: true },
    })
    if (blockingBooking) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        'Target seat is already booked for selected slot.',
      )
    }

    const activeHold = await tx.hold.findFirst({
      where: {
        clubId: params.clubId,
        slotId: target.slotId,
        seatId: target.seatId,
        status: HoldStatus.ACTIVE,
        expiresAtUtc: { gt: now },
      },
      select: {
        id: true,
      },
      orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
    })
    if (activeHold) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        'Target seat is currently held.',
      )
    }

    const requestedPackageId =
      params.packageId === undefined
        ? booking.packageId || undefined
        : params.packageId || undefined

    const quote = await generatePriceQuote({
      clubId: params.clubId,
      roomId: target.roomId,
      segmentId: target.segmentId,
      startAt: target.slotStartAt,
      endAt: target.slotEndAt,
      packageId: requestedPackageId,
      channel: booking.channel,
      customerType: booking.customerType,
      persistQuote: true,
    })

    const oldTotal = booking.priceTotalCents ?? 0
    const newTotal = quote.total
    const delta = newTotal - oldTotal
    const requiredAction = computeRequiredAction({
      delta,
      mode: params.mode,
      policy,
    })
    if (requiredAction === RescheduleRequiredAction.BLOCKED) {
      throw new RescheduleFlowError(
        'RESCHEDULE_DELTA_NEGATIVE_NOT_SUPPORTED',
        409,
        'Negative delta reschedule is not available for clients.',
      )
    }

    const reasonRequired =
      params.mode === 'STAFF' && (eligibility.policyOverrideUsed || delta < 0)
    if (reasonRequired && !reason) {
      throw new RescheduleFlowError(
        'VALIDATION_ERROR',
        400,
        'reason is required for policy override or negative delta reschedule.',
      )
    }

    const expiresAt = new Date(now.getTime() + policy.rescheduleHoldTtlMinutes * 60_000)

    const lockHold = await tx.hold.create({
      data: {
        clubId: params.clubId,
        slotId: target.slotId,
        seatId: target.seatId,
        ownerUserId: params.actorUserId,
        purpose: HoldPurpose.RESCHEDULE_TARGET,
        status: HoldStatus.ACTIVE,
        expiresAtUtc: expiresAt,
      },
      select: {
        id: true,
      },
    })

    const intent = await tx.rescheduleIntent.create({
      data: {
        clubId: params.clubId,
        bookingId: booking.id,
        oldSlotId: booking.slotId,
        oldSeatId: booking.seatId,
        newSlotId: target.slotId,
        newSeatId: target.seatId,
        newRoomId: target.roomId,
        packageId: requestedPackageId || null,
        lockHoldId: lockHold.id,
        status: RescheduleIntentStatus.ACTIVE,
        expiresAtUtc: expiresAt,
        createdByUserId: params.actorUserId,
        createdByRole:
          params.mode === 'CLIENT'
            ? RescheduleActorRole.CLIENT
            : RescheduleActorRole.STAFF,
        reason: reason,
        policyOverrideUsed: eligibility.policyOverrideUsed,
        oldPriceTotal: oldTotal,
        newPriceTotal: newTotal,
        delta,
        requiredAction,
        paymentStatus:
          requiredAction === RescheduleRequiredAction.PAY_EXTRA
            ? ReschedulePaymentStatus.PENDING
            : ReschedulePaymentStatus.NONE,
        settlementStatus: RescheduleSettlementStatus.NONE,
        newQuoteSnapshotJson: JSON.stringify(quote),
      },
      select: {
        id: true,
        expiresAtUtc: true,
        oldPriceTotal: true,
        newPriceTotal: true,
        delta: true,
        requiredAction: true,
        newQuoteSnapshotJson: true,
        policyOverrideUsed: true,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'reschedule.intent_created',
        entityType: 'reschedule_intent',
        entityId: intent.id,
        bookingId: booking.id,
        metadata: JSON.stringify({
          oldSlotId: booking.slotId,
          oldSeatId: booking.seatId,
          newSlotId: target.slotId,
          newSeatId: target.seatId,
          oldTotal,
          newTotal,
          delta,
          requiredAction,
          policyOverrideUsed: eligibility.policyOverrideUsed,
          expiresAtUtc: intent.expiresAtUtc.toISOString(),
        }),
      },
    })

    return {
      rescheduleId: intent.id,
      expiresAt: intent.expiresAtUtc,
      oldTotal: intent.oldPriceTotal,
      newTotal: intent.newPriceTotal,
      delta: intent.delta,
      requiredAction: intent.requiredAction,
      newQuote: asQuoteSnapshot(intent.newQuoteSnapshotJson),
      policyOverrideUsed: intent.policyOverrideUsed,
      targetSlotId: target.slotId,
    } satisfies CreateIntentResult & { targetSlotId: string }
  })

  invalidateAvailabilityCacheForClubSlot(params.clubId, result.targetSlotId)

  return {
    rescheduleId: result.rescheduleId,
    expiresAt: result.expiresAt,
    oldTotal: result.oldTotal,
    newTotal: result.newTotal,
    delta: result.delta,
    requiredAction: result.requiredAction,
    newQuote: result.newQuote,
    policyOverrideUsed: result.policyOverrideUsed,
  } satisfies CreateIntentResult
}

function resolvePaymentOutcome(params: {
  mode: RescheduleMode
  delta: number
  payMode: ReschedulePayMode
}) {
  if (params.delta > 0) {
    if (params.payMode === 'ONLINE') {
      return {
        intentPaymentStatus: ReschedulePaymentStatus.PAID,
        settlementStatus: RescheduleSettlementStatus.EXTRA_PAID,
        bookingPaymentStatus: PaymentStatus.PAID,
      }
    }
    if (params.payMode === 'OFFLINE') {
      return {
        intentPaymentStatus: ReschedulePaymentStatus.PENDING,
        settlementStatus: RescheduleSettlementStatus.EXTRA_PENDING,
        bookingPaymentStatus: PaymentStatus.PENDING,
      }
    }
    throw new RescheduleFlowError(
      'VALIDATION_ERROR',
      400,
      'payMode is required when delta is positive.',
    )
  }

  if (params.delta < 0) {
    if (params.mode !== 'STAFF') {
      throw new RescheduleFlowError(
        'RESCHEDULE_DELTA_NEGATIVE_NOT_SUPPORTED',
        409,
        'Negative delta reschedule is not available for clients.',
      )
    }
    return {
      intentPaymentStatus: ReschedulePaymentStatus.NONE,
      settlementStatus: RescheduleSettlementStatus.CREDIT_PENDING,
      bookingPaymentStatus: null as PaymentStatus | null,
    }
  }

  return {
    intentPaymentStatus: ReschedulePaymentStatus.NONE,
    settlementStatus: RescheduleSettlementStatus.NONE,
    bookingPaymentStatus: null as PaymentStatus | null,
  }
}

export async function confirmRescheduleIntent(params: {
  rescheduleId: string
  clubId: string
  mode: RescheduleMode
  actorUserId: string
  payMode?: ReschedulePayMode
  reason?: string | null
  allowStaffOverride?: boolean
  now?: Date
}) {
  const now = params.now ?? new Date()
  const payMode = params.payMode ?? 'NONE'
  const inputReason = normalizeReason(params.reason)

  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.rescheduleIntent.findFirst({
      where: {
        id: params.rescheduleId,
        clubId: params.clubId,
      },
      select: {
        id: true,
        clubId: true,
        bookingId: true,
        oldSlotId: true,
        oldSeatId: true,
        newSlotId: true,
        newSeatId: true,
        newRoomId: true,
        packageId: true,
        lockHoldId: true,
        status: true,
        expiresAtUtc: true,
        createdByUserId: true,
        createdByRole: true,
        reason: true,
        policyOverrideUsed: true,
        oldPriceTotal: true,
        newPriceTotal: true,
        delta: true,
        requiredAction: true,
        paymentStatus: true,
        settlementStatus: true,
        newQuoteSnapshotJson: true,
      },
    })
    if (!intent) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
    }
    if (intent.status === RescheduleIntentStatus.CONFIRMED) {
      const booking = await tx.booking.findUnique({
        where: { id: intent.bookingId },
        select: {
          id: true,
          status: true,
          slotId: true,
          seatId: true,
          checkIn: true,
          checkOut: true,
        },
      })
      if (!booking) {
        throw new RescheduleFlowError('NOT_FOUND', 404, 'Booking was not found.')
      }
      return {
        bookingId: booking.id,
        status: booking.status,
        slotId: booking.slotId,
        seatId: booking.seatId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        delta: intent.delta,
        settlementStatus: intent.settlementStatus,
        oldSlotId: intent.oldSlotId,
        newSlotId: intent.newSlotId,
      } satisfies ConfirmIntentResult & { oldSlotId: string | null; newSlotId: string }
    }
    if (intent.status !== RescheduleIntentStatus.ACTIVE) {
      throw new RescheduleFlowError(
        'RESCHEDULE_NOT_ACTIVE',
        409,
        'Reschedule intent is no longer active.',
      )
    }

    const booking = await loadBookingForReschedule(tx, {
      bookingId: intent.bookingId,
      clubId: params.clubId,
    })

    const expiredSlots = await expireStaleRescheduleIntents(tx, {
      clubId: params.clubId,
      bookingId: booking.id,
      now,
    })
    if (expiredSlots.length > 0) {
      for (const slotId of expiredSlots) {
        invalidateAvailabilityCacheForClubSlot(params.clubId, slotId)
      }
    }

    const freshIntent = await tx.rescheduleIntent.findUnique({
      where: { id: intent.id },
      select: {
        id: true,
        status: true,
        expiresAtUtc: true,
        lockHoldId: true,
        newSlotId: true,
        newSeatId: true,
        oldSlotId: true,
        delta: true,
        newPriceTotal: true,
        newRoomId: true,
        packageId: true,
        reason: true,
        policyOverrideUsed: true,
        newQuoteSnapshotJson: true,
      },
    })
    if (!freshIntent || freshIntent.status !== RescheduleIntentStatus.ACTIVE) {
      throw new RescheduleFlowError('RESCHEDULE_EXPIRED', 409, 'Reschedule intent expired.')
    }
    if (freshIntent.expiresAtUtc <= now) {
      await tx.rescheduleIntent.update({
        where: { id: freshIntent.id },
        data: { status: RescheduleIntentStatus.EXPIRED },
      })
      if (freshIntent.lockHoldId) {
        await tx.hold.updateMany({
          where: {
            id: freshIntent.lockHoldId,
            status: HoldStatus.ACTIVE,
          },
          data: {
            status: HoldStatus.EXPIRED,
          },
        })
      }
      throw new RescheduleFlowError('RESCHEDULE_EXPIRED', 409, 'Reschedule intent expired.')
    }

    const club = await tx.club.findUnique({
      where: { id: params.clubId },
      select: { id: true, reschedulePolicyJson: true },
    })
    if (!club) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Club was not found.')
    }

    const policy = resolveReschedulePolicy(club.reschedulePolicyJson)
    const eligibility = evaluateEligibility({
      mode: params.mode,
      policy,
      booking,
      now,
      allowStaffOverride: (params.allowStaffOverride ?? false) || freshIntent.policyOverrideUsed,
    })
    if (!eligibility.eligible) {
      throw new RescheduleFlowError(
        eligibility.code || 'RESCHEDULE_NOT_ALLOWED_POLICY',
        409,
        eligibility.error || 'Reschedule is not allowed by policy.',
      )
    }

    const finalReason = freshIntent.reason || inputReason
    if (params.mode === 'STAFF' && (freshIntent.policyOverrideUsed || freshIntent.delta < 0) && !finalReason) {
      throw new RescheduleFlowError(
        'VALIDATION_ERROR',
        400,
        'reason is required for policy override or negative delta reschedule.',
      )
    }

    const lockHold = freshIntent.lockHoldId
      ? await tx.hold.findUnique({
          where: { id: freshIntent.lockHoldId },
          select: {
            id: true,
            status: true,
            purpose: true,
            slotId: true,
            seatId: true,
            expiresAtUtc: true,
          },
        })
      : null
    if (
      !lockHold ||
      lockHold.status !== HoldStatus.ACTIVE ||
      lockHold.purpose !== HoldPurpose.RESCHEDULE_TARGET ||
      lockHold.expiresAtUtc <= now ||
      lockHold.slotId !== freshIntent.newSlotId ||
      lockHold.seatId !== freshIntent.newSeatId
    ) {
      if (freshIntent.lockHoldId) {
        await tx.hold.updateMany({
          where: {
            id: freshIntent.lockHoldId,
            status: HoldStatus.ACTIVE,
          },
          data: {
            status: HoldStatus.EXPIRED,
          },
        })
      }
      await tx.rescheduleIntent.update({
        where: { id: freshIntent.id },
        data: { status: RescheduleIntentStatus.EXPIRED },
      })
      throw new RescheduleFlowError('RESCHEDULE_EXPIRED', 409, 'Reschedule intent expired.')
    }

    const targetSlot = await tx.slot.findFirst({
      where: {
        id: freshIntent.newSlotId,
        clubId: params.clubId,
      },
      select: {
        id: true,
        status: true,
        startAtUtc: true,
        endAtUtc: true,
      },
    })
    if (!targetSlot || targetSlot.status !== SlotStatus.PUBLISHED || targetSlot.endAtUtc <= now) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        'Target slot is no longer available.',
      )
    }

    const latestMapVersion = await tx.seatMapVersion.findFirst({
      where: { clubId: params.clubId },
      orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
      select: { id: true },
    })
    if (!latestMapVersion) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        'No published map version found for target club.',
      )
    }
    const targetSeat = await tx.seatIndex.findFirst({
      where: {
        clubId: params.clubId,
        mapVersionId: latestMapVersion.id,
        seatId: freshIntent.newSeatId,
        isActive: true,
      },
      select: {
        seatId: true,
        label: true,
        isDisabled: true,
        disabledReason: true,
      },
    })
    if (!targetSeat || targetSeat.isDisabled) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        targetSeat?.disabledReason
          ? `Seat is disabled: ${targetSeat.disabledReason}`
          : 'Target seat is no longer available.',
      )
    }

    const activeBooking = await tx.booking.findFirst({
      where: {
        id: { not: booking.id },
        clubId: params.clubId,
        slotId: freshIntent.newSlotId,
        seatId: freshIntent.newSeatId,
        status: { in: [...seatBlockingBookingStatuses()] },
      },
      select: { id: true },
    })
    if (activeBooking) {
      throw new RescheduleFlowError(
        'TARGET_NOT_AVAILABLE',
        409,
        'Target seat is already booked.',
      )
    }

    const quoteSnapshot = asQuoteSnapshot(freshIntent.newQuoteSnapshotJson)
    const paymentOutcome = resolvePaymentOutcome({
      mode: params.mode,
      delta: freshIntent.delta,
      payMode,
    })

    const beforeSnapshot = {
      slotId: booking.slotId,
      seatId: booking.seatId,
      roomId: booking.roomId,
      checkIn: booking.checkIn.toISOString(),
      checkOut: booking.checkOut.toISOString(),
      packageId: booking.packageId,
      pricingVersionId: booking.pricingVersionId,
      priceTotalCents: booking.priceTotalCents,
      priceCurrency: booking.priceCurrency,
      paymentStatus: booking.paymentStatus,
      rescheduleCount: booking.rescheduleCount,
    }

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        slotId: freshIntent.newSlotId,
        seatId: freshIntent.newSeatId,
        seatLabelSnapshot: targetSeat.label || targetSeat.seatId,
        roomId: freshIntent.newRoomId ?? booking.roomId,
        packageId: freshIntent.packageId,
        pricingVersionId:
          typeof quoteSnapshot.pricingVersionId === 'string'
            ? quoteSnapshot.pricingVersionId
            : booking.pricingVersionId,
        quoteId:
          typeof quoteSnapshot.quoteId === 'string'
            ? quoteSnapshot.quoteId
            : booking.quoteId,
        checkIn: targetSlot.startAtUtc,
        checkOut: targetSlot.endAtUtc,
        priceTotalCents: freshIntent.newPriceTotal,
        priceCurrency:
          typeof quoteSnapshot.currency === 'string'
            ? quoteSnapshot.currency
            : booking.priceCurrency,
        priceSnapshotJson: JSON.stringify(quoteSnapshot.breakdown ?? []),
        packageSnapshotJson: quoteSnapshot.package
          ? JSON.stringify(quoteSnapshot.package)
          : null,
        rescheduleCount: {
          increment: 1,
        },
        ...(paymentOutcome.bookingPaymentStatus
          ? { paymentStatus: paymentOutcome.bookingPaymentStatus }
          : {}),
      },
      select: {
        id: true,
        status: true,
        slotId: true,
        seatId: true,
        checkIn: true,
        checkOut: true,
        roomId: true,
        packageId: true,
        priceTotalCents: true,
        priceCurrency: true,
        paymentStatus: true,
        rescheduleCount: true,
      },
    })

    await tx.hold.update({
      where: { id: lockHold.id },
      data: {
        status: HoldStatus.CONVERTED,
        canceledAtUtc: now,
        canceledByUserId: params.actorUserId,
      },
    })

    await tx.rescheduleIntent.update({
      where: { id: freshIntent.id },
      data: {
        status: RescheduleIntentStatus.CONFIRMED,
        confirmedAt: now,
        paymentStatus: paymentOutcome.intentPaymentStatus,
        settlementStatus: paymentOutcome.settlementStatus,
        reason: finalReason ?? null,
      },
    })

    const afterSnapshot = {
      slotId: updatedBooking.slotId,
      seatId: updatedBooking.seatId,
      roomId: updatedBooking.roomId,
      checkIn: updatedBooking.checkIn.toISOString(),
      checkOut: updatedBooking.checkOut.toISOString(),
      packageId: updatedBooking.packageId,
      priceTotalCents: updatedBooking.priceTotalCents,
      priceCurrency: updatedBooking.priceCurrency,
      paymentStatus: updatedBooking.paymentStatus,
      rescheduleCount: updatedBooking.rescheduleCount,
    }

    await tx.bookingEvent.create({
      data: {
        bookingId: booking.id,
        clubId: params.clubId,
        eventType: 'RESCHEDULE',
        actorUserId: params.actorUserId,
        beforeJson: JSON.stringify(beforeSnapshot),
        afterJson: JSON.stringify(afterSnapshot),
        reason: finalReason ?? null,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'reschedule.intent_confirmed',
        entityType: 'reschedule_intent',
        entityId: freshIntent.id,
        bookingId: booking.id,
        metadata: JSON.stringify({
          oldSlotId: freshIntent.oldSlotId,
          oldSeatId: booking.seatId,
          newSlotId: freshIntent.newSlotId,
          newSeatId: freshIntent.newSeatId,
          delta: freshIntent.delta,
          payMode,
          settlementStatus: paymentOutcome.settlementStatus,
        }),
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'booking.rescheduled',
        entityType: 'booking',
        entityId: String(booking.id),
        bookingId: booking.id,
        metadata: JSON.stringify({
          before: beforeSnapshot,
          after: afterSnapshot,
          reason: finalReason ?? null,
        }),
      },
    })

    return {
      bookingId: updatedBooking.id,
      status: updatedBooking.status,
      slotId: updatedBooking.slotId,
      seatId: updatedBooking.seatId,
      checkIn: updatedBooking.checkIn,
      checkOut: updatedBooking.checkOut,
      delta: freshIntent.delta,
      settlementStatus: paymentOutcome.settlementStatus,
      oldSlotId: freshIntent.oldSlotId,
      newSlotId: freshIntent.newSlotId,
    } satisfies ConfirmIntentResult & { oldSlotId: string | null; newSlotId: string }
  })

  if (result.oldSlotId) {
    invalidateAvailabilityCacheForClubSlot(params.clubId, result.oldSlotId)
  }
  invalidateAvailabilityCacheForClubSlot(params.clubId, result.newSlotId)

  return {
    bookingId: result.bookingId,
    status: result.status,
    slotId: result.slotId,
    seatId: result.seatId,
    checkIn: result.checkIn,
    checkOut: result.checkOut,
    delta: result.delta,
    settlementStatus: result.settlementStatus,
  } satisfies ConfirmIntentResult
}

export async function cancelRescheduleIntent(params: {
  rescheduleId: string
  clubId: string
  actorUserId: string
  now?: Date
}) {
  const now = params.now ?? new Date()

  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.rescheduleIntent.findFirst({
      where: {
        id: params.rescheduleId,
        clubId: params.clubId,
      },
      select: {
        id: true,
        status: true,
        bookingId: true,
        lockHoldId: true,
        newSlotId: true,
        expiresAtUtc: true,
        createdAt: true,
        updatedAt: true,
        oldPriceTotal: true,
        newPriceTotal: true,
        delta: true,
        requiredAction: true,
        paymentStatus: true,
        settlementStatus: true,
        oldSlotId: true,
        oldSeatId: true,
        newSeatId: true,
        newQuoteSnapshotJson: true,
        createdByRole: true,
        createdByUserId: true,
        reason: true,
        policyOverrideUsed: true,
        confirmedAt: true,
        canceledAt: true,
        clubId: true,
      },
    })
    if (!intent) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
    }

    if (intent.status === RescheduleIntentStatus.ACTIVE && intent.expiresAtUtc <= now) {
      await tx.rescheduleIntent.update({
        where: { id: intent.id },
        data: {
          status: RescheduleIntentStatus.EXPIRED,
        },
      })
      if (intent.lockHoldId) {
        await tx.hold.updateMany({
          where: {
            id: intent.lockHoldId,
            status: HoldStatus.ACTIVE,
          },
          data: {
            status: HoldStatus.EXPIRED,
          },
        })
      }
      const expired = await tx.rescheduleIntent.findUnique({ where: { id: intent.id } })
      if (!expired) {
        throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
      }
      return serializeIntent(expired)
    }

    if (intent.status !== RescheduleIntentStatus.ACTIVE) {
      return serializeIntent(intent)
    }

    if (intent.lockHoldId) {
      await tx.hold.updateMany({
        where: {
          id: intent.lockHoldId,
          status: HoldStatus.ACTIVE,
        },
        data: {
          status: HoldStatus.CANCELED,
          canceledAtUtc: now,
          canceledByUserId: params.actorUserId,
        },
      })
    }

    const canceled = await tx.rescheduleIntent.update({
      where: { id: intent.id },
      data: {
        status: RescheduleIntentStatus.CANCELED,
        canceledAt: now,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'reschedule.intent_canceled',
        entityType: 'reschedule_intent',
        entityId: intent.id,
        bookingId: intent.bookingId,
        metadata: JSON.stringify({
          newSlotId: intent.newSlotId,
          newSeatId: intent.newSeatId,
        }),
      },
    })

    return serializeIntent(canceled)
  })

  invalidateAvailabilityCacheForClubSlot(params.clubId, result.newSlotId)
  return result
}

export async function getRescheduleIntent(params: {
  rescheduleId: string
  clubId: string
  now?: Date
}) {
  const now = params.now ?? new Date()

  const intent = await prisma.$transaction(async (tx) => {
    const rawIntent = await tx.rescheduleIntent.findFirst({
      where: {
        id: params.rescheduleId,
        clubId: params.clubId,
      },
    })
    if (!rawIntent) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
    }

    if (rawIntent.status === RescheduleIntentStatus.ACTIVE && rawIntent.expiresAtUtc <= now) {
      const updates: Prisma.RescheduleIntentUpdateInput = {
        status: RescheduleIntentStatus.EXPIRED,
      }
      const expired = await tx.rescheduleIntent.update({
        where: { id: rawIntent.id },
        data: updates,
      })
      if (expired.lockHoldId) {
        await tx.hold.updateMany({
          where: {
            id: expired.lockHoldId,
            status: HoldStatus.ACTIVE,
          },
          data: {
            status: HoldStatus.EXPIRED,
          },
        })
      }
      return expired
    }

    return rawIntent
  })

  return serializeIntent(intent)
}
