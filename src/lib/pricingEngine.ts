import {
  ChannelType,
  CustomerType,
  PricingPackage,
  PricingPackagePricingType,
  PricingRule,
  PricingRuleFixedMode,
  PricingRuleType,
  PricingScopeType,
  PromotionType,
  RoundingRule,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { PricingError } from '@/src/lib/pricingErrors'
import { evaluatePromotionForQuote } from '@/src/lib/promoService'
import { isFeatureEnabled } from '@/src/lib/featureFlags'

export type QuoteInput = {
  clubId: string
  seatId?: string
  roomId?: number
  segmentId?: string
  startAt: Date
  endAt: Date
  packageId?: string
  channel?: ChannelType
  customerType?: CustomerType
  promoCode?: string
  promoUserId?: string
  promoCustomerId?: string
  strictPromoCode?: boolean
  persistQuote?: boolean
}

type BreakdownLine = {
  type: string
  label: string
  amount: number
  metadata?: Record<string, unknown>
}

type NormalizedContext = {
  clubId: string
  roomId?: number
  segmentId: string
  clubTimeZone: string
  startAt: Date
  endAt: Date
  channel: ChannelType
  customerType: CustomerType
  startMinuteOfDay: number
  startDayOfWeek: number
  durationMinutes: number
}

function asArray(csv?: string | null) {
  if (!csv) return []
  return csv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const datePartFormatterCache = new Map<string, Intl.DateTimeFormat>()
const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>()

function datePartFormatterForTimeZone(timeZone: string) {
  const existing = datePartFormatterCache.get(timeZone)
  if (existing) return existing
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
  datePartFormatterCache.set(timeZone, formatter)
  return formatter
}

function weekdayFormatterForTimeZone(timeZone: string) {
  const existing = weekdayFormatterCache.get(timeZone)
  if (existing) return existing
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  })
  weekdayFormatterCache.set(timeZone, formatter)
  return formatter
}

function weekdayToNumber(value: string) {
  const normalized = value.slice(0, 3).toLowerCase()
  if (normalized === 'sun') return 0
  if (normalized === 'mon') return 1
  if (normalized === 'tue') return 2
  if (normalized === 'wed') return 3
  if (normalized === 'thu') return 4
  if (normalized === 'fri') return 5
  return 6
}

function getStartMinuteOfDay(date: Date, timeZone: string) {
  const formatter = datePartFormatterForTimeZone(timeZone)
  const parts = formatter.formatToParts(date)
  const hourPart = parts.find((part) => part.type === 'hour')?.value ?? '0'
  const minutePart = parts.find((part) => part.type === 'minute')?.value ?? '0'
  const hour = Number(hourPart)
  const minute = Number(minutePart)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0
  }
  return hour * 60 + minute
}

function getDayOfWeek(date: Date, timeZone: string) {
  const formatter = weekdayFormatterForTimeZone(timeZone)
  const dayValue = formatter.format(date)
  return weekdayToNumber(dayValue)
}

function appliesByDay(csv: string | null, dayOfWeek: number) {
  if (!csv) return true
  return asArray(csv).includes(String(dayOfWeek))
}

function appliesByTimeWindow(
  startMinute: number | null,
  endMinute: number | null,
  bookingStartMinute: number,
) {
  if (startMinute == null || endMinute == null) return true
  if (startMinute === endMinute) return true

  if (startMinute < endMinute) {
    return bookingStartMinute >= startMinute && bookingStartMinute < endMinute
  }

  return bookingStartMinute >= startMinute || bookingStartMinute < endMinute
}

function matchesRule(
  rule: PricingRule,
  context: NormalizedContext,
  roomId?: number,
) {
  if (rule.channel && rule.channel !== context.channel) return false
  if (rule.customerType && rule.customerType !== context.customerType) return false
  if (!appliesByDay(rule.dayOfWeekCsv, context.startDayOfWeek)) return false
  if (
    !appliesByTimeWindow(
      rule.timeWindowStartMinute,
      rule.timeWindowEndMinute,
      context.startMinuteOfDay,
    )
  ) {
    return false
  }

  if (rule.scopeType === PricingScopeType.SEGMENT) {
    return rule.scopeId === context.segmentId
  }
  if (rule.scopeType === PricingScopeType.ROOM) {
    return roomId != null && rule.scopeId === String(roomId)
  }
  return false
}

function roundToInteger(value: number) {
  return Math.round(value)
}

function applyRounding(value: number, mode: RoundingRule) {
  if (mode === RoundingRule.NONE) return value
  if (mode === RoundingRule.ROUND_TO_10) return roundToInteger(value / 10) * 10
  if (mode === RoundingRule.ROUND_TO_50) return roundToInteger(value / 50) * 50
  return roundToInteger(value / 100) * 100
}

function hashQuoteRequest(context: QuoteInput) {
  return JSON.stringify({
    clubId: context.clubId,
    seatId: context.seatId ?? null,
    roomId: context.roomId ?? null,
    segmentId: context.segmentId ?? null,
    startAt: context.startAt.toISOString(),
    endAt: context.endAt.toISOString(),
    packageId: context.packageId ?? null,
    channel: context.channel ?? ChannelType.ONLINE,
    customerType: context.customerType ?? CustomerType.GUEST,
    promoCode: context.promoCode?.trim().toUpperCase() ?? null,
    promoUserId: context.promoUserId ?? null,
    promoCustomerId: context.promoCustomerId ?? null,
  })
}

function toDurationMinutes(startAt: Date, endAt: Date) {
  const value = (endAt.getTime() - startAt.getTime()) / 60000
  return Math.round(value)
}

function packageVisibleInChannel(pricingPackage: PricingPackage, channel: ChannelType) {
  if (channel === ChannelType.ONLINE) return pricingPackage.visibleToClients
  return pricingPackage.visibleToHosts
}

async function resolveContext(input: QuoteInput): Promise<{
  context: NormalizedContext
  room: Awaited<ReturnType<typeof prisma.room.findFirst>>
  club: NonNullable<Awaited<ReturnType<typeof prisma.club.findUnique>>>
}> {
  const club = await prisma.club.findUnique({
    where: { id: input.clubId },
  })
  if (!club) {
    throw new PricingError('CLUB_NOT_FOUND', 'Club was not found.', 404)
  }

  const room =
    input.roomId != null
      ? await prisma.room.findFirst({
          where: {
            id: input.roomId,
            clubId: input.clubId,
          },
        })
      : null

  if (input.roomId != null && !room) {
    throw new PricingError('ROOM_NOT_FOUND', 'Room was not found in selected club.', 404)
  }

  const segmentId = input.segmentId ?? room?.segmentId ?? null
  if (!segmentId) {
    throw new PricingError('SEGMENT_REQUIRED', 'Segment is required for price quote.', 400)
  }

  const durationMinutes = toDurationMinutes(input.startAt, input.endAt)
  if (durationMinutes <= 0) {
    throw new PricingError('INVALID_TIME_RANGE', 'End time must be after start time.', 400)
  }

  const context: NormalizedContext = {
    clubId: input.clubId,
    roomId: input.roomId,
    segmentId,
    clubTimeZone: club.timezone,
    startAt: input.startAt,
    endAt: input.endAt,
    channel: input.channel ?? ChannelType.ONLINE,
    customerType: input.customerType ?? CustomerType.GUEST,
    startMinuteOfDay: getStartMinuteOfDay(input.startAt, club.timezone),
    startDayOfWeek: getDayOfWeek(input.startAt, club.timezone),
    durationMinutes,
  }

  return { context, room, club }
}

function packageApplies(
  pricingPackage: PricingPackage & {
    segmentLinks: Array<{ segmentId: string }>
    roomLinks: Array<{ roomId: number }>
  },
  context: NormalizedContext,
) {
  if (!pricingPackage.isActive) return false
  if (!packageVisibleInChannel(pricingPackage, context.channel)) return false

  if (!appliesByDay(pricingPackage.daysOfWeekCsv, context.startDayOfWeek)) return false
  if (
    !appliesByTimeWindow(
      pricingPackage.timeWindowStartMinute,
      pricingPackage.timeWindowEndMinute,
      context.startMinuteOfDay,
    )
  ) {
    return false
  }

  if (pricingPackage.segmentLinks.length > 0) {
    const allowed = pricingPackage.segmentLinks.some(
      (segmentLink) => segmentLink.segmentId === context.segmentId,
    )
    if (!allowed) return false
  }

  if (pricingPackage.roomLinks.length > 0) {
    const allowed = pricingPackage.roomLinks.some(
      (roomLink) => roomLink.roomId === context.roomId,
    )
    if (!allowed) return false
  }

  return true
}

export async function listApplicablePackages(input: QuoteInput) {
  const { context } = await resolveContext(input)

  const packages = await prisma.pricingPackage.findMany({
    where: {
      clubId: input.clubId,
      isActive: true,
    },
    include: {
      segmentLinks: true,
      roomLinks: true,
    },
    orderBy: [{ durationMinutes: 'asc' }, { name: 'asc' }],
  })

  return packages.filter((pricingPackage) => packageApplies(pricingPackage, context))
}

export async function generatePriceQuote(input: QuoteInput) {
  const { context, room, club } = await resolveContext(input)

  const activeVersion = await prisma.pricingVersion.findFirst({
    where: {
      clubId: context.clubId,
      status: 'PUBLISHED',
      effectiveFrom: { lte: context.startAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: context.startAt } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { publishedAt: 'desc' }, { versionNumber: 'desc' }],
    include: {
      rules: {
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })

  if (!activeVersion) {
    throw new PricingError(
      'PRICING_NO_ACTIVE_VERSION',
      'No active published pricing version for this club.',
      409,
    )
  }

  const breakdown: BreakdownLine[] = []
  const appliedRuleIds: string[] = []
  const roomId = context.roomId

  const baseRules = activeVersion.rules.filter(
    (rule) =>
      rule.ruleType === PricingRuleType.BASE_RATE &&
      matchesRule(rule, context, roomId) &&
      rule.setRatePerHourCents != null,
  )

  const selectedBaseRule =
    [...baseRules].sort((a, b) => b.priority - a.priority)[0] ?? null

  const fallbackRate = room?.pricePerNightCents ?? 0
  let ratePerHour = selectedBaseRule?.setRatePerHourCents ?? fallbackRate

  if (!ratePerHour || ratePerHour < 0) {
    throw new PricingError(
      'SEAT_SEGMENT_NOT_COVERED',
      'No base rate available for quote context.',
      409,
      { segmentId: context.segmentId },
    )
  }

  if (selectedBaseRule) {
    appliedRuleIds.push(selectedBaseRule.id)
  }

  const overrideRules = activeVersion.rules
    .filter(
      (rule) =>
        rule.ruleType === PricingRuleType.OVERRIDE &&
        matchesRule(rule, context, roomId) &&
        rule.setRatePerHourCents != null,
    )
    .sort((a, b) => {
      const scopeRankA = a.scopeType === PricingScopeType.ROOM ? 2 : 1
      const scopeRankB = b.scopeType === PricingScopeType.ROOM ? 2 : 1
      if (scopeRankA !== scopeRankB) return scopeRankB - scopeRankA
      return b.priority - a.priority
    })

  if (overrideRules[0]?.setRatePerHourCents != null) {
    ratePerHour = overrideRules[0].setRatePerHourCents
    appliedRuleIds.push(overrideRules[0].id)
  }

  const durationHours = context.durationMinutes / 60
  let subtotal = roundToInteger(ratePerHour * durationHours)
  breakdown.push({
    type: 'BASE_RATE',
    label: 'Segment base rate',
    amount: subtotal,
    metadata: { ratePerHour },
  })

  let selectedPackage:
    | (PricingPackage & {
        segmentLinks: Array<{ segmentId: string }>
        roomLinks: Array<{ roomId: number }>
      })
    | null = null

  if (input.packageId) {
    const pricingPackage = await prisma.pricingPackage.findFirst({
      where: {
        id: input.packageId,
        clubId: context.clubId,
      },
      include: {
        segmentLinks: true,
        roomLinks: true,
      },
    })

    if (!pricingPackage || !packageApplies(pricingPackage, context)) {
      throw new PricingError('PACKAGE_NOT_ELIGIBLE', 'Selected package is not applicable.', 409)
    }

    selectedPackage = pricingPackage
  }

  let shouldApplyModifiers = true
  if (selectedPackage?.pricingType === PricingPackagePricingType.FIXED_PRICE) {
    if (selectedPackage.fixedPriceCents == null) {
      throw new PricingError('PACKAGE_CONFIG_INVALID', 'Package fixed price is not configured.', 409)
    }
    const previous = subtotal
    subtotal = selectedPackage.fixedPriceCents
    breakdown.push({
      type: 'PACKAGE',
      label: `${selectedPackage.name} fixed price`,
      amount: subtotal - previous,
    })
    shouldApplyModifiers = selectedPackage.applyTimeModifiers
  } else if (selectedPackage?.pricingType === PricingPackagePricingType.RATE_PER_HOUR) {
    if (selectedPackage.ratePerHourCents == null) {
      throw new PricingError('PACKAGE_CONFIG_INVALID', 'Package hourly rate is not configured.', 409)
    }
    const previous = subtotal
    subtotal = roundToInteger(selectedPackage.ratePerHourCents * durationHours)
    breakdown.push({
      type: 'PACKAGE',
      label: `${selectedPackage.name} package rate`,
      amount: subtotal - previous,
      metadata: { ratePerHour: selectedPackage.ratePerHourCents },
    })
    shouldApplyModifiers = selectedPackage.applyTimeModifiers
  }

  const allModifiers = activeVersion.rules.filter(
    (rule) =>
      rule.ruleType === PricingRuleType.TIME_MODIFIER &&
      matchesRule(rule, context, roomId),
  )

  let modifiers = allModifiers
  const exclusiveModifiers = allModifiers
    .filter((rule) => rule.exclusive)
    .sort((a, b) => b.priority - a.priority)

  if (exclusiveModifiers.length > 0) {
    modifiers = [exclusiveModifiers[0]]
  }

  if (shouldApplyModifiers) {
    const percentModifiers = modifiers
      .filter((rule) => rule.addPercent != null)
      .sort((a, b) => a.priority - b.priority)
    const fixedModifiers = modifiers
      .filter((rule) => rule.addFixedAmountCents != null)
      .sort((a, b) => a.priority - b.priority)

    for (const modifier of percentModifiers) {
      const addPercent = modifier.addPercent ?? 0
      const delta = roundToInteger((subtotal * addPercent) / 100)
      if (delta !== 0) {
        subtotal += delta
        appliedRuleIds.push(modifier.id)
        breakdown.push({
          type: 'TIME_MODIFIER',
          label: modifier.label || `Modifier ${addPercent}%`,
          amount: delta,
        })
      }
    }

    for (const modifier of fixedModifiers) {
      const amount = modifier.addFixedAmountCents ?? 0
      let delta = amount
      if (modifier.addFixedMode === PricingRuleFixedMode.PER_HOUR) {
        delta = roundToInteger(amount * durationHours)
      }
      if (delta !== 0) {
        subtotal += delta
        appliedRuleIds.push(modifier.id)
        breakdown.push({
          type: 'TIME_MODIFIER',
          label: modifier.label || 'Fixed modifier',
          amount: delta,
        })
      }
    }
  }

  if (selectedPackage?.pricingType === PricingPackagePricingType.DISCOUNTED_HOURLY) {
    const discountPercent = selectedPackage.discountPercent ?? 0
    const delta = -roundToInteger((subtotal * discountPercent) / 100)
    subtotal += delta
    breakdown.push({
      type: 'PACKAGE',
      label: `${selectedPackage.name} discount`,
      amount: delta,
    })
  }

  const now = new Date()
  const promoFeatureEnabled = isFeatureEnabled('promos')
  const promoEvaluation = !promoFeatureEnabled
    ? (() => {
        const requestedCode = input.promoCode?.trim().toUpperCase() || null
        if (requestedCode && input.strictPromoCode !== false) {
          throw new PricingError('PROMO_NOT_ACTIVE', 'Promotions are temporarily disabled.', 409, {
            reason: 'DISABLED_BY_FLAG',
            requestedCode,
          })
        }
        return {
          requestedCode,
          status: requestedCode ? ('REJECTED' as const) : ('NONE' as const),
          rejectionReason: requestedCode ? ('NOT_ACTIVE' as const) : null,
          appliedPromotion: null,
          discountAmount: 0,
        }
      })()
    : await evaluatePromotionForQuote({
        clubId: context.clubId,
        now,
        subtotal,
        promoCode: input.promoCode,
        segmentId: context.segmentId,
        roomId: room?.id ?? context.roomId ?? null,
        packageId: selectedPackage?.id ?? null,
        channel: context.channel,
        startMinuteOfDay: context.startMinuteOfDay,
        startDayOfWeek: context.startDayOfWeek,
        userId: input.promoUserId,
        customerId: input.promoCustomerId,
        strictPromoCode: input.strictPromoCode,
      }).catch((error) => {
        if (error instanceof PricingError && error.code === 'PROMO_INVALID') {
          throw new PricingError(
            'PROMO_INVALID_CODE',
            'Promo code is invalid.',
            error.statusCode,
            error.details,
          )
        }
        throw error
      })

  const appliedPromotion = promoEvaluation.appliedPromotion
  if (appliedPromotion && promoEvaluation.discountAmount > 0) {
    subtotal -= promoEvaluation.discountAmount
    breakdown.push({
      type: 'PROMO',
      label: appliedPromotion.code || appliedPromotion.name || 'Automatic promo',
      amount: -promoEvaluation.discountAmount,
      metadata: {
        promoId: appliedPromotion.id,
        promoCode: appliedPromotion.code ?? null,
        status: promoEvaluation.status,
      },
    })
  }

  const roundedTotal = applyRounding(subtotal, club.rounding)
  if (roundedTotal !== subtotal) {
    breakdown.push({
      type: 'ROUNDING',
      label: `Rounding (${club.rounding})`,
      amount: roundedTotal - subtotal,
    })
  }

  const totalCents = Math.max(0, roundedTotal)
  const computedAt = now
  const validUntil = new Date(now.getTime() + 10 * 60 * 1000)

  const quotePayload = {
    quoteId: '',
    currency: club.currency,
    pricingVersionId: activeVersion.id,
    total: totalCents,
    breakdown,
    rulesApplied: appliedRuleIds,
    computedAt: computedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    package: selectedPackage
      ? {
          id: selectedPackage.id,
          name: selectedPackage.name,
          durationMinutes: selectedPackage.durationMinutes,
          pricingType: selectedPackage.pricingType,
        }
      : null,
    promotion: appliedPromotion
      ? {
          id: appliedPromotion.id,
          code: appliedPromotion.code,
          type: appliedPromotion.type,
          status: 'APPLIED',
          discountAmount: promoEvaluation.discountAmount,
          requestedCode: promoEvaluation.requestedCode,
        }
      : promoEvaluation.status === 'REJECTED'
        ? {
            id: null,
            code: promoEvaluation.requestedCode,
            type: null,
            status: 'REJECTED',
            requestedCode: promoEvaluation.requestedCode,
            rejectionReason: promoEvaluation.rejectionReason,
            discountAmount: 0,
          }
        : null,
  }

  if (input.persistQuote === false) {
    return quotePayload
  }

  const quote = await prisma.priceQuote.create({
    data: {
      clubId: context.clubId,
      pricingVersionId: activeVersion.id,
      promotionId: appliedPromotion?.id,
      requestHash: hashQuoteRequest(input),
      contextJson: JSON.stringify({
        roomId: context.roomId,
        segmentId: context.segmentId,
        startAt: context.startAt.toISOString(),
        endAt: context.endAt.toISOString(),
        packageId: selectedPackage?.id || null,
        channel: context.channel,
        customerType: context.customerType,
        promoCode: input.promoCode || null,
      }),
      breakdownJson: JSON.stringify(breakdown),
      currency: club.currency,
      totalCents,
      validUntil,
    },
  })

  quotePayload.quoteId = quote.id
  return quotePayload
}
