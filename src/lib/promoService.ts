import {
  ChannelType,
  Prisma,
  PromotionType,
  type PrismaClient,
  type Promotion,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { PricingError } from '@/src/lib/pricingErrors'

type DbClient = PrismaClient | Prisma.TransactionClient

type JsonObject = Record<string, unknown>

export type PromoRejectionReason =
  | 'INVALID_CODE'
  | 'EXPIRED'
  | 'NOT_ACTIVE'
  | 'NOT_ELIGIBLE_SEGMENT'
  | 'NOT_ELIGIBLE_ROOM'
  | 'NOT_ELIGIBLE_PACKAGE'
  | 'NOT_ELIGIBLE_CHANNEL'
  | 'NOT_ELIGIBLE_TIME'
  | 'MIN_SPEND_NOT_MET'
  | 'USAGE_LIMIT_REACHED'
  | 'FIRST_BOOKING_ONLY_FAILED'

export type PromoEvaluationResult = {
  requestedCode: string | null
  status: 'APPLIED' | 'REJECTED' | 'NONE'
  rejectionReason: PromoRejectionReason | null
  appliedPromotion: Promotion | null
  discountAmount: number
}

export type PromoQuoteContext = {
  clubId: string
  now: Date
  subtotal: number
  promoCode?: string | null
  segmentId?: string | null
  roomId?: number | null
  packageId?: string | null
  channel: ChannelType
  startMinuteOfDay: number
  startDayOfWeek: number
  userId?: string | null
  customerId?: string | null
  strictPromoCode?: boolean
}

export type PromoStats = {
  uses: number
  totalDiscount: number
}

export class PromoManagementError extends Error {
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

type PromoConstraints = {
  segmentIds?: string[]
  roomIds?: number[]
  packageIds?: string[]
  channel?: 'ONLINE' | 'OFFLINE' | 'BOTH'
  minSubtotal?: number
  maxDiscountAmount?: number
  daysOfWeek?: number[]
  timeWindowStartMinute?: number
  timeWindowEndMinute?: number
  firstBookingOnly?: boolean
}

type PromoUsageRules = {
  maxTotalUses?: number
  maxUsesPerUser?: number
  maxUsesPerCustomer?: number
}

export type PromoWriteInput = {
  clubId: string
  actorUserId: string
  promoId?: string
  code?: string | null
  name?: string | null
  descriptionPublic?: string | null
  type: PromotionType
  value: number
  activeFromUtc: Date
  activeToUtc: Date
  isActive?: boolean
  constraints?: PromoConstraints | null
  usage?: PromoUsageRules | null
}

function readJsonObject(value: string | null | undefined): JsonObject | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
  } catch {
    // ignore malformed legacy payloads
  }
  return null
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[]
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [] as number[]
  return value
    .map((item) => (typeof item === 'number' ? Math.trunc(item) : Number(item)))
    .filter((item) => Number.isInteger(item))
}

function asInteger(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.trunc(parsed)
}

function appliesTimeWindow(
  startMinute: number | null | undefined,
  endMinute: number | null | undefined,
  bookingStartMinute: number,
) {
  if (startMinute == null || endMinute == null) return true
  if (startMinute === endMinute) return true
  if (startMinute < endMinute) {
    return bookingStartMinute >= startMinute && bookingStartMinute < endMinute
  }
  return bookingStartMinute >= startMinute || bookingStartMinute < endMinute
}

function parseCsv(csv: string | null | undefined) {
  if (!csv) return [] as string[]
  return csv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizePromoCode(code: string | null | undefined) {
  const normalized = code?.trim().toUpperCase() || ''
  return normalized || null
}

function requireString(value: string | null | undefined, field: string) {
  const normalized = value?.trim() || ''
  if (!normalized) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, `${field} is required.`)
  }
  return normalized
}

function isPercentPromo(type: PromotionType) {
  return type === PromotionType.PROMO_CODE_PERCENT || type === PromotionType.AUTO_TIME_PROMO
}

function isAutomaticPromo(promotion: Pick<Promotion, 'type' | 'code'>) {
  return (
    promotion.type === PromotionType.AUTO_TIME_PROMO ||
    promotion.type === PromotionType.AUTO_FIXED_PROMO ||
    !promotion.code
  )
}

export function derivePromotionLifecycleStatus(promotion: Pick<Promotion, 'isActive' | 'activeFrom' | 'activeTo'>, now = new Date()) {
  if (promotion.activeTo.getTime() < now.getTime()) return 'EXPIRED' as const
  if (!promotion.isActive) return 'PAUSED' as const
  if (promotion.activeFrom.getTime() > now.getTime()) return 'DRAFT' as const
  return 'ACTIVE' as const
}

function normalizeConstraints(input: PromoConstraints | null | undefined): PromoConstraints | null {
  if (!input) return null
  const output: PromoConstraints = {}
  if (input.segmentIds?.length) output.segmentIds = Array.from(new Set(input.segmentIds.map((v) => v.trim()).filter(Boolean)))
  if (input.roomIds?.length) {
    output.roomIds = Array.from(new Set(input.roomIds.map((v) => Math.trunc(Number(v))).filter((v) => Number.isInteger(v))))
  }
  if (input.packageIds?.length) output.packageIds = Array.from(new Set(input.packageIds.map((v) => v.trim()).filter(Boolean)))
  if (input.channel === 'ONLINE' || input.channel === 'OFFLINE' || input.channel === 'BOTH') {
    output.channel = input.channel
  }
  if (Number.isInteger(input.minSubtotal)) output.minSubtotal = Math.max(0, input.minSubtotal as number)
  if (Number.isInteger(input.maxDiscountAmount)) {
    output.maxDiscountAmount = Math.max(0, input.maxDiscountAmount as number)
  }
  if (input.daysOfWeek?.length) {
    output.daysOfWeek = Array.from(
      new Set(
        input.daysOfWeek
          .map((value) => Math.trunc(Number(value)))
          .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
      ),
    )
  }
  if (Number.isInteger(input.timeWindowStartMinute)) {
    output.timeWindowStartMinute = Math.max(0, Math.min(1439, Math.trunc(input.timeWindowStartMinute as number)))
  }
  if (Number.isInteger(input.timeWindowEndMinute)) {
    output.timeWindowEndMinute = Math.max(0, Math.min(1439, Math.trunc(input.timeWindowEndMinute as number)))
  }
  if (input.firstBookingOnly === true) output.firstBookingOnly = true
  return Object.keys(output).length > 0 ? output : null
}

function normalizeUsage(input: PromoUsageRules | null | undefined): PromoUsageRules | null {
  if (!input) return null
  const output: PromoUsageRules = {}
  if (Number.isInteger(input.maxTotalUses)) output.maxTotalUses = Math.max(0, input.maxTotalUses as number)
  if (Number.isInteger(input.maxUsesPerUser)) {
    output.maxUsesPerUser = Math.max(0, input.maxUsesPerUser as number)
  }
  if (Number.isInteger(input.maxUsesPerCustomer)) {
    output.maxUsesPerCustomer = Math.max(0, input.maxUsesPerCustomer as number)
  }
  return Object.keys(output).length > 0 ? output : null
}

function promotionWriteData(input: PromoWriteInput): Prisma.PromotionUncheckedCreateInput | Prisma.PromotionUncheckedUpdateInput {
  if (!(input.activeFromUtc instanceof Date) || Number.isNaN(input.activeFromUtc.getTime())) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'activeFromUtc is invalid.')
  }
  if (!(input.activeToUtc instanceof Date) || Number.isNaN(input.activeToUtc.getTime())) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'activeToUtc is invalid.')
  }
  if (input.activeToUtc.getTime() <= input.activeFromUtc.getTime()) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'activeToUtc must be after activeFromUtc.')
  }

  const normalizedCode = input.code === undefined ? undefined : normalizePromoCode(input.code)
  const normalizedName =
    input.name === undefined ? undefined : (input.name?.trim() || null)
  const normalizedDescription =
    input.descriptionPublic === undefined ? undefined : (input.descriptionPublic?.trim() || null)

  if (normalizedCode != null && normalizedCode.length > 40) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'code must be at most 40 chars.')
  }
  if (normalizedName != null && normalizedName.length > 120) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'name must be at most 120 chars.')
  }
  if (
    (input.type === PromotionType.PROMO_CODE_PERCENT || input.type === PromotionType.PROMO_CODE_FIXED) &&
    !normalizedCode
  ) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'code is required for code promotions.')
  }
  if (
    (input.type === PromotionType.AUTO_TIME_PROMO || input.type === PromotionType.AUTO_FIXED_PROMO) &&
    normalizedCode
  ) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'Automatic promotions cannot define a code.')
  }

  const isPercent = isPercentPromo(input.type)
  const value = Number(input.value)
  if (!Number.isFinite(value)) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'value must be a number.')
  }
  if (isPercent) {
    if (value <= 0 || value > 100) {
      throw new PromoManagementError('VALIDATION_ERROR', 400, 'Percent promo value must be > 0 and <= 100.')
    }
  } else if (!Number.isInteger(value) || value <= 0) {
    throw new PromoManagementError('VALIDATION_ERROR', 400, 'Fixed promo value must be a positive integer.')
  }

  const constraints = normalizeConstraints(input.constraints)
  const usage = normalizeUsage(input.usage)
  const legacySegments = constraints?.segmentIds?.length ? constraints.segmentIds.join(',') : null
  const legacyPackages = constraints?.packageIds?.length ? constraints.packageIds.join(',') : null

  const base: Prisma.PromotionUncheckedCreateInput = {
    clubId: input.clubId,
    code: normalizedCode ?? null,
    name: normalizedName ?? normalizedCode ?? 'Promotion',
    descriptionPublic: normalizedDescription ?? null,
    type: input.type,
    activeFrom: input.activeFromUtc,
    activeTo: input.activeToUtc,
    percentOff: isPercent ? value : null,
    fixedOffCents: isPercent ? null : Math.trunc(value),
    minTotalCents: constraints?.minSubtotal ?? null,
    maxUsesTotal: usage?.maxTotalUses ?? null,
    constraintsJson: constraints ? JSON.stringify(constraints) : null,
    usageJson: usage ? JSON.stringify(usage) : null,
    applicableSegmentIdsCsv: legacySegments,
    applicablePackageIdsCsv: legacyPackages,
    isActive: input.isActive ?? true,
  }
  return base
}

function mapUniqueError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new PromoManagementError('DUPLICATE_CODE', 409, 'Promo code already exists in this club.')
  }
  throw error
}

function getConstraints(promotion: Promotion): PromoConstraints {
  const json = readJsonObject(promotion.constraintsJson)
  const constraints: PromoConstraints = {}

  const segmentIds = asStringArray(json?.segmentIds)
  const roomIds = asNumberArray(json?.roomIds)
  const packageIds = asStringArray(json?.packageIds)
  const channel = json?.channel
  const daysOfWeek = asNumberArray(json?.daysOfWeek)

  if (segmentIds.length > 0) constraints.segmentIds = segmentIds
  if (roomIds.length > 0) constraints.roomIds = roomIds
  if (packageIds.length > 0) constraints.packageIds = packageIds
  if (channel === 'ONLINE' || channel === 'OFFLINE' || channel === 'BOTH') {
    constraints.channel = channel
  }
  if (daysOfWeek.length > 0) constraints.daysOfWeek = daysOfWeek

  const minSubtotal = asInteger(json?.minSubtotal)
  if (minSubtotal != null) constraints.minSubtotal = minSubtotal

  const maxDiscountAmount = asInteger(json?.maxDiscountAmount)
  if (maxDiscountAmount != null) constraints.maxDiscountAmount = maxDiscountAmount

  const timeWindowStartMinute = asInteger(json?.timeWindowStartMinute)
  const timeWindowEndMinute = asInteger(json?.timeWindowEndMinute)
  if (timeWindowStartMinute != null) constraints.timeWindowStartMinute = timeWindowStartMinute
  if (timeWindowEndMinute != null) constraints.timeWindowEndMinute = timeWindowEndMinute

  if (json?.firstBookingOnly === true) constraints.firstBookingOnly = true

  // Backward-compatible legacy columns remain authoritative if JSON omitted.
  if (constraints.minSubtotal == null && promotion.minTotalCents != null) {
    constraints.minSubtotal = promotion.minTotalCents
  }
  if (!constraints.segmentIds?.length) {
    const legacySegments = parseCsv(promotion.applicableSegmentIdsCsv)
    if (legacySegments.length > 0) constraints.segmentIds = legacySegments
  }
  if (!constraints.packageIds?.length) {
    const legacyPackages = parseCsv(promotion.applicablePackageIdsCsv)
    if (legacyPackages.length > 0) constraints.packageIds = legacyPackages
  }

  return constraints
}

function getUsageRules(promotion: Promotion): PromoUsageRules {
  const json = readJsonObject(promotion.usageJson)
  const usage: PromoUsageRules = {}
  const maxTotalUses = asInteger(json?.maxTotalUses)
  const maxUsesPerUser = asInteger(json?.maxUsesPerUser)
  const maxUsesPerCustomer = asInteger(json?.maxUsesPerCustomer)
  if (maxTotalUses != null) usage.maxTotalUses = maxTotalUses
  if (maxUsesPerUser != null) usage.maxUsesPerUser = maxUsesPerUser
  if (maxUsesPerCustomer != null) usage.maxUsesPerCustomer = maxUsesPerCustomer
  if (usage.maxTotalUses == null && promotion.maxUsesTotal != null) {
    usage.maxTotalUses = promotion.maxUsesTotal
  }
  return usage
}

async function checkUsageLimits(
  db: DbClient,
  promotion: Promotion,
  params: {
    userId?: string | null
    customerId?: string | null
  },
): Promise<PromoRejectionReason | null> {
  const usage = getUsageRules(promotion)

  const globalUses = usage.maxTotalUses
  if (globalUses != null && promotion.usesCount >= globalUses) {
    return 'USAGE_LIMIT_REACHED'
  }

  if (usage.maxUsesPerUser != null && params.userId) {
    const count = await db.promoRedemption.count({
      where: {
        promoId: promotion.id,
        userId: params.userId,
      },
    })
    if (count >= usage.maxUsesPerUser) return 'USAGE_LIMIT_REACHED'
  }

  if (usage.maxUsesPerCustomer != null && params.customerId) {
    const count = await db.promoRedemption.count({
      where: {
        promoId: promotion.id,
        customerId: params.customerId,
      },
    })
    if (count >= usage.maxUsesPerCustomer) return 'USAGE_LIMIT_REACHED'
  }

  return null
}

async function evaluatePromotionEligibility(
  db: DbClient,
  promotion: Promotion,
  context: PromoQuoteContext,
): Promise<PromoRejectionReason | null> {
  const now = context.now
  if (!promotion.isActive) return 'NOT_ACTIVE'
  if (promotion.activeFrom.getTime() > now.getTime()) return 'NOT_ACTIVE'
  if (promotion.activeTo.getTime() < now.getTime()) return 'EXPIRED'

  const constraints = getConstraints(promotion)
  if (constraints.channel && constraints.channel !== 'BOTH' && constraints.channel !== context.channel) {
    return 'NOT_ELIGIBLE_CHANNEL'
  }
  if (constraints.minSubtotal != null && context.subtotal < constraints.minSubtotal) {
    return 'MIN_SPEND_NOT_MET'
  }
  if (constraints.segmentIds?.length && context.segmentId) {
    if (!constraints.segmentIds.includes(context.segmentId)) return 'NOT_ELIGIBLE_SEGMENT'
  } else if (constraints.segmentIds?.length && !context.segmentId) {
    return 'NOT_ELIGIBLE_SEGMENT'
  }
  if (constraints.roomIds?.length && context.roomId != null) {
    if (!constraints.roomIds.includes(context.roomId)) return 'NOT_ELIGIBLE_ROOM'
  } else if (constraints.roomIds?.length) {
    return 'NOT_ELIGIBLE_ROOM'
  }
  if (constraints.packageIds?.length) {
    if (!context.packageId || !constraints.packageIds.includes(context.packageId)) {
      return 'NOT_ELIGIBLE_PACKAGE'
    }
  }
  if (constraints.daysOfWeek?.length && !constraints.daysOfWeek.includes(context.startDayOfWeek)) {
    return 'NOT_ELIGIBLE_TIME'
  }
  if (
    !appliesTimeWindow(
      constraints.timeWindowStartMinute,
      constraints.timeWindowEndMinute,
      context.startMinuteOfDay,
    )
  ) {
    return 'NOT_ELIGIBLE_TIME'
  }
  if (constraints.firstBookingOnly && context.userId) {
    const existing = await db.booking.count({
      where: {
        clientUserId: context.userId,
        status: {
          in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] as const,
        },
      },
    })
    if (existing > 0) return 'FIRST_BOOKING_ONLY_FAILED'
  }

  return checkUsageLimits(db, promotion, {
    userId: context.userId,
    customerId: context.customerId,
  })
}

function computePromoDiscountAmount(promotion: Promotion, subtotal: number) {
  let discount = 0
  if (isPercentPromo(promotion.type)) {
    discount = Math.round((subtotal * (promotion.percentOff ?? 0)) / 100)
  } else {
    discount = promotion.fixedOffCents ?? 0
  }

  const constraints = getConstraints(promotion)
  if (constraints.maxDiscountAmount != null) {
    discount = Math.min(discount, Math.max(0, constraints.maxDiscountAmount))
  }

  discount = Math.max(0, Math.trunc(discount))
  if (discount > subtotal) discount = subtotal
  return discount
}

export async function evaluatePromotionForQuote(
  context: PromoQuoteContext,
): Promise<PromoEvaluationResult> {
  const requestedCode = normalizePromoCode(context.promoCode)
  const strictPromoCode = context.strictPromoCode ?? true

  if (requestedCode) {
    const promotion = await prisma.promotion.findFirst({
      where: {
        clubId: context.clubId,
        code: requestedCode,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    })

    if (!promotion) {
      if (strictPromoCode) {
        throw new PricingError('PROMO_INVALID_CODE', 'Promo code is invalid.', 409, {
          reason: 'INVALID_CODE',
          requestedCode,
        })
      }
      return {
        requestedCode,
        status: 'REJECTED',
        rejectionReason: 'INVALID_CODE',
        appliedPromotion: null,
        discountAmount: 0,
      }
    }

    const rejectionReason = await evaluatePromotionEligibility(prisma, promotion, context)
    if (rejectionReason) {
      if (strictPromoCode) {
        throw new PricingError(
          promotionErrorCodeForReason(rejectionReason),
          `Promo code is not applicable: ${rejectionReason}.`,
          409,
          { reason: rejectionReason, requestedCode },
        )
      }
      return {
        requestedCode,
        status: 'REJECTED',
        rejectionReason,
        appliedPromotion: null,
        discountAmount: 0,
      }
    }

    return {
      requestedCode,
      status: 'APPLIED',
      rejectionReason: null,
      appliedPromotion: promotion,
      discountAmount: computePromoDiscountAmount(promotion, context.subtotal),
    }
  }

  const candidates = await prisma.promotion.findMany({
    where: {
      clubId: context.clubId,
      isActive: true,
      OR: [
        { type: PromotionType.AUTO_TIME_PROMO },
        { type: PromotionType.AUTO_FIXED_PROMO },
        { code: null },
      ],
      activeFrom: { lte: context.now },
      activeTo: { gte: context.now },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  })

  let best: { promotion: Promotion; discountAmount: number } | null = null
  for (const candidate of candidates) {
    if (!isAutomaticPromo(candidate)) continue
    const rejectionReason = await evaluatePromotionEligibility(prisma, candidate, context)
    if (rejectionReason) continue
    const discountAmount = computePromoDiscountAmount(candidate, context.subtotal)
    if (discountAmount <= 0) continue
    if (
      !best ||
      discountAmount > best.discountAmount ||
      (discountAmount === best.discountAmount &&
        candidate.updatedAt.getTime() > best.promotion.updatedAt.getTime()) ||
      (discountAmount === best.discountAmount &&
        candidate.updatedAt.getTime() === best.promotion.updatedAt.getTime() &&
        candidate.id < best.promotion.id)
    ) {
      best = { promotion: candidate, discountAmount }
    }
  }

  if (!best) {
    return {
      requestedCode: null,
      status: 'NONE',
      rejectionReason: null,
      appliedPromotion: null,
      discountAmount: 0,
    }
  }

  return {
    requestedCode: null,
    status: 'APPLIED',
    rejectionReason: null,
    appliedPromotion: best.promotion,
    discountAmount: best.discountAmount,
  }
}

export function promotionErrorCodeForReason(reason: PromoRejectionReason) {
  switch (reason) {
    case 'INVALID_CODE':
      return 'PROMO_INVALID_CODE' as const
    case 'EXPIRED':
      return 'PROMO_EXPIRED' as const
    case 'NOT_ACTIVE':
      return 'PROMO_NOT_ACTIVE' as const
    case 'NOT_ELIGIBLE_SEGMENT':
      return 'PROMO_NOT_ELIGIBLE_SEGMENT' as const
    case 'MIN_SPEND_NOT_MET':
      return 'PROMO_MIN_SPEND_NOT_MET' as const
    case 'USAGE_LIMIT_REACHED':
      return 'PROMO_USAGE_LIMIT_REACHED' as const
    default:
      return 'PROMO_NOT_ELIGIBLE' as const
  }
}

export function getPromoDiscountFromBreakdown(
  breakdown: Array<{ type?: string; amount?: number }>,
) {
  return breakdown.reduce((sum, line) => {
    if (line.type !== 'PROMO') return sum
    const amount = typeof line.amount === 'number' ? line.amount : 0
    if (amount >= 0) return sum
    return sum + Math.abs(Math.trunc(amount))
  }, 0)
}

export async function consumePromotionRedemptionForBooking(params: {
  tx: Prisma.TransactionClient
  bookingId: number
  clubId: string
  promotionId: string | null | undefined
  promoCode: string | null | undefined
  discountAmountCents: number
  userId?: string | null
  customerId?: string | null
  actorUserId?: string | null
}) {
  const discountAmountCents = Math.max(0, Math.trunc(params.discountAmountCents))
  if (!params.promotionId || discountAmountCents <= 0) {
    return null
  }

  const promotion = await params.tx.promotion.findFirst({
    where: {
      id: params.promotionId,
      clubId: params.clubId,
    },
  })
  if (!promotion) {
    throw new PricingError('PROMO_INVALID_CODE', 'Promotion was not found during booking confirm.', 409)
  }

  const now = new Date()
  const usage = getUsageRules(promotion)
  if (!promotion.isActive || promotion.activeFrom.getTime() > now.getTime() || promotion.activeTo.getTime() < now.getTime()) {
    throw new PricingError('PROMO_NOT_ACTIVE', 'Promotion is not active for final redemption.', 409, {
      promoId: promotion.id,
    })
  }

  const usageRejection = await checkUsageLimits(params.tx as unknown as DbClient, promotion, {
    userId: params.userId,
    customerId: params.customerId,
  })
  if (usageRejection === 'USAGE_LIMIT_REACHED') {
    throw new PricingError('PROMO_USAGE_LIMIT_REACHED', 'Promo usage limit has been reached.', 409, {
      reason: usageRejection,
      promoId: promotion.id,
    })
  }

  if (usage.maxTotalUses != null) {
    const updated = await params.tx.promotion.updateMany({
      where: {
        id: promotion.id,
        clubId: params.clubId,
        usesCount: { lt: usage.maxTotalUses },
      },
      data: {
        usesCount: { increment: 1 },
      },
    })
    if (updated.count !== 1) {
      throw new PricingError('PROMO_USAGE_LIMIT_REACHED', 'Promo usage limit has been reached.', 409, {
        reason: 'USAGE_LIMIT_REACHED',
        promoId: promotion.id,
      })
    }
  } else {
    await params.tx.promotion.update({
      where: { id: promotion.id },
      data: {
        usesCount: { increment: 1 },
      },
    })
  }

  const redemption = await params.tx.promoRedemption.create({
    data: {
      promoId: promotion.id,
      clubId: params.clubId,
      bookingId: params.bookingId,
      userId: params.userId ?? null,
      customerId: params.customerId ?? null,
      discountAmountCents,
      promoCodeSnapshot: params.promoCode ? normalizePromoCode(params.promoCode) : null,
    },
  })

  if (params.actorUserId) {
    await params.tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'promo.redeemed',
        entityType: 'promotion',
        entityId: promotion.id,
        bookingId: params.bookingId,
        metadata: JSON.stringify({
          promoCode: redemption.promoCodeSnapshot,
          discountAmountCents,
          bookingId: params.bookingId,
          userId: params.userId ?? null,
          customerId: params.customerId ?? null,
        }),
      },
    })
  }

  return redemption
}

export async function getPromotionStats(clubId: string, promoId: string): Promise<PromoStats> {
  const aggregate = await prisma.promoRedemption.aggregate({
    where: {
      clubId,
      promoId,
    },
    _count: { _all: true },
    _sum: { discountAmountCents: true },
  })

  return {
    uses: aggregate._count._all,
    totalDiscount: aggregate._sum.discountAmountCents ?? 0,
  }
}

export function serializePromotionForApi(promotion: Promotion, now = new Date()) {
  const constraints = getConstraints(promotion)
  const usage = getUsageRules(promotion)

  return {
    promoId: promotion.id,
    clubId: promotion.clubId,
    code: promotion.code,
    name: promotion.name ?? promotion.code ?? 'Promotion',
    descriptionPublic: promotion.descriptionPublic ?? null,
    type: promotion.type,
    status: derivePromotionLifecycleStatus(promotion, now),
    activeFromUtc: promotion.activeFrom.toISOString(),
    activeToUtc: promotion.activeTo.toISOString(),
    percentOff: promotion.percentOff,
    fixedOffCents: promotion.fixedOffCents,
    usesCount: promotion.usesCount,
    constraints,
    usage,
    createdAt: promotion.createdAt.toISOString(),
    updatedAt: promotion.updatedAt.toISOString(),
  }
}

export async function listPromotions(params: {
  clubId: string
  status?: string | null
  q?: string | null
}) {
  const q = params.q?.trim() || null
  const where: Prisma.PromotionWhereInput = {
    clubId: params.clubId,
  }
  if (q) {
    where.OR = [
      { code: { contains: q.toUpperCase() } },
      { name: { contains: q } },
      { descriptionPublic: { contains: q } },
    ]
  }

  const items = await prisma.promotion.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  })
  const now = new Date()
  const normalizedStatus = params.status?.trim().toUpperCase() || null
  return items
    .filter((item) => {
      if (!normalizedStatus) return true
      return derivePromotionLifecycleStatus(item, now) === normalizedStatus
    })
    .map((item) => serializePromotionForApi(item, now))
}

export async function getPromotionForClub(clubId: string, promoId: string) {
  const promo = await prisma.promotion.findFirst({
    where: {
      id: promoId,
      clubId,
    },
  })
  if (!promo) {
    throw new PromoManagementError('NOT_FOUND', 404, 'Promo was not found.')
  }
  return promo
}

export async function createPromotion(params: PromoWriteInput) {
  try {
    const data = promotionWriteData(params) as Prisma.PromotionUncheckedCreateInput
    const created = await prisma.promotion.create({ data })
    await prisma.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'promo.created',
        entityType: 'promotion',
        entityId: created.id,
        metadata: JSON.stringify({
          code: created.code,
          type: created.type,
          isActive: created.isActive,
        }),
      },
    })
    return created
  } catch (error) {
    mapUniqueError(error)
    throw error
  }
}

export async function updatePromotion(params: PromoWriteInput & { promoId: string }) {
  const existing = await getPromotionForClub(params.clubId, params.promoId)
  try {
    const data = promotionWriteData(params) as Prisma.PromotionUncheckedUpdateInput
    const updated = await prisma.promotion.update({
      where: { id: existing.id },
      data,
    })
    await prisma.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'promo.updated',
        entityType: 'promotion',
        entityId: updated.id,
      },
    })
    return updated
  } catch (error) {
    mapUniqueError(error)
    throw error
  }
}

export async function setPromotionPaused(params: {
  clubId: string
  actorUserId: string
  promoId: string
  isActive: boolean
}) {
  const existing = await getPromotionForClub(params.clubId, params.promoId)
  const updated = await prisma.promotion.update({
    where: { id: existing.id },
    data: {
      isActive: params.isActive,
    },
  })
  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: params.isActive ? 'promo.activated' : 'promo.paused',
      entityType: 'promotion',
      entityId: updated.id,
      metadata: JSON.stringify({
        previousIsActive: existing.isActive,
        nextIsActive: updated.isActive,
      }),
    },
  })
  return updated
}
