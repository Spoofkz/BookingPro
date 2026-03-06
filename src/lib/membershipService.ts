import {
  MembershipActorRole,
  MembershipEntitlementStatus,
  MembershipPlanStatus,
  MembershipPlanType,
  MembershipTransactionType,
  PaymentStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

type DbClient = PrismaClient | Prisma.TransactionClient

type EntitlementWithPlan = Prisma.MembershipEntitlementGetPayload<{
  include: { plan: true }
}>

export type MembershipPaymentPreference = 'MEMBERSHIP_FIRST' | 'WALLET_FIRST' | 'CASH'

export type MembershipSelectionInput = {
  entitlementId?: string | null
  useWallet?: boolean
  paymentPreference?: MembershipPaymentPreference
}

export type MembershipAppliedLine = {
  entitlementId: string
  planId: string | null
  type: MembershipPlanType
  label: string
  amountCovered: number
  minutesConsumed: number
  sessionsConsumed: number
  walletConsumed: number
}

export type MembershipQuotePreview = {
  baseTotal: number
  remainingDue: number
  currency: string
  preference: MembershipPaymentPreference
  applied: MembershipAppliedLine[]
  estimatedBalances: Array<{
    entitlementId: string
    type: MembershipPlanType
    remainingMinutes: number | null
    remainingSessions: number | null
    walletBalance: number | null
    validTo: Date | null
  }>
}

export type BookingMembershipConsumption = {
  baseTotal: number
  remainingDue: number
  currency: string | null
  preference: MembershipPaymentPreference
  applied: MembershipAppliedLine[]
  appliedAt: string
}

export type PurchaseMode = 'OFFLINE' | 'ONLINE'

type JsonObject = Record<string, unknown>

type EligibilityContext = {
  segmentId?: string | null
  roomId?: number | null
  seatId?: string | null
  startAt: Date
  endAt: Date
}

export class MembershipFlowError extends Error {
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

function readJsonObject(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonObject
    }
    return null
  } catch {
    return null
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function asBoolean(value: unknown) {
  return value === true
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) return Math.trunc(item)
      if (typeof item === 'string' && item.trim()) {
        const parsed = Number(item)
        if (Number.isFinite(parsed)) return Math.trunc(parsed)
      }
      return null
    })
    .filter((item): item is number => item !== null)
}

function durationMinutes(startAt: Date, endAt: Date) {
  const minutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
  return Math.max(1, minutes)
}

function minuteOfDay(date: Date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

function dayOfWeek(date: Date) {
  return date.getUTCDay()
}

function normalizePreference(input: MembershipPaymentPreference | null | undefined) {
  if (input === 'WALLET_FIRST') return 'WALLET_FIRST' as const
  if (input === 'CASH') return 'CASH' as const
  return 'MEMBERSHIP_FIRST' as const
}

function computeEntitlementStatus(params: {
  type: MembershipPlanType
  remainingMinutes: number | null
  remainingSessions: number | null
  walletBalance: number | null
  validTo: Date | null
  now: Date
}) {
  if (params.validTo && params.validTo <= params.now) {
    return MembershipEntitlementStatus.EXPIRED
  }

  if (params.type === MembershipPlanType.TIME_PACK) {
    if ((params.remainingMinutes ?? 0) <= 0) return MembershipEntitlementStatus.DEPLETED
  }
  if (params.type === MembershipPlanType.SESSION_PACK) {
    if ((params.remainingSessions ?? 0) <= 0) return MembershipEntitlementStatus.DEPLETED
  }
  if (params.type === MembershipPlanType.WALLET_TOPUP) {
    if ((params.walletBalance ?? 0) <= 0) return MembershipEntitlementStatus.DEPLETED
  }

  return MembershipEntitlementStatus.ACTIVE
}

function parseExpiryPolicy(expiryPolicyJson: string | null | undefined, purchasedAt: Date) {
  const policy = readJsonObject(expiryPolicyJson)
  if (!policy) return null

  const daysAfterPurchase =
    asNumber(policy.daysAfterPurchase) ?? asNumber(policy.expiresInDays) ?? null
  if (daysAfterPurchase != null && daysAfterPurchase > 0) {
    return new Date(purchasedAt.getTime() + Math.trunc(daysAfterPurchase) * 24 * 60 * 60 * 1000)
  }

  const fixedEndDate = asString(policy.fixedEndDate)
  if (fixedEndDate) {
    const date = new Date(fixedEndDate)
    if (!Number.isNaN(date.getTime())) return date
  }

  return null
}

function parseMembershipEligibility(plan: EntitlementWithPlan['plan']) {
  if (!plan) return { segmentIds: [], roomIds: [], seatIds: [] }
  const eligibility = readJsonObject(plan.eligibilityJson)
  if (!eligibility) return { segmentIds: [], roomIds: [], seatIds: [] }

  const segmentIds = asStringArray(eligibility.segmentIds)
  const seatIds = asStringArray(eligibility.seatIds)
  const roomIds = asNumberArray(eligibility.roomIds)

  return { segmentIds, roomIds, seatIds }
}

function parseTimeRestrictions(plan: EntitlementWithPlan['plan']) {
  if (!plan) {
    return {
      days: [] as number[],
      windows: [] as Array<{ startMinute: number; endMinute: number }>,
    }
  }

  const restrictions = readJsonObject(plan.timeRestrictionsJson)
  if (!restrictions) {
    return {
      days: [] as number[],
      windows: [] as Array<{ startMinute: number; endMinute: number }>,
    }
  }

  const days = asNumberArray(restrictions.daysOfWeek ?? restrictions.allowedDays)
  const windowsRaw = Array.isArray(restrictions.windows) ? restrictions.windows : []
  const windows = windowsRaw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const row = item as Record<string, unknown>
      const startMinute = asNumber(row.startMinute)
      const endMinute = asNumber(row.endMinute)
      if (startMinute == null || endMinute == null) return null
      return {
        startMinute: Math.max(0, Math.min(1439, Math.trunc(startMinute))),
        endMinute: Math.max(0, Math.min(1439, Math.trunc(endMinute))),
      }
    })
    .filter((item): item is { startMinute: number; endMinute: number } => Boolean(item))

  return { days, windows }
}

function timeWindowMatches(
  startMinute: number,
  endMinute: number,
  bookingMinute: number,
) {
  if (startMinute === endMinute) return true
  if (startMinute < endMinute) {
    return bookingMinute >= startMinute && bookingMinute < endMinute
  }
  return bookingMinute >= startMinute || bookingMinute < endMinute
}

function entitlementEligibleForContext(
  entitlement: EntitlementWithPlan,
  context: EligibilityContext,
) {
  if (entitlement.type === MembershipPlanType.WALLET_TOPUP) {
    return true
  }

  const eligibility = parseMembershipEligibility(entitlement.plan)
  if (eligibility.segmentIds.length > 0) {
    if (!context.segmentId || !eligibility.segmentIds.includes(context.segmentId)) return false
  }
  if (eligibility.roomIds.length > 0) {
    if (!context.roomId || !eligibility.roomIds.includes(context.roomId)) return false
  }
  if (eligibility.seatIds.length > 0) {
    if (!context.seatId || !eligibility.seatIds.includes(context.seatId)) return false
  }

  const restrictions = parseTimeRestrictions(entitlement.plan)
  if (restrictions.days.length > 0) {
    if (!restrictions.days.includes(dayOfWeek(context.startAt))) return false
  }
  if (restrictions.windows.length > 0) {
    const bookingMinute = minuteOfDay(context.startAt)
    const allowed = restrictions.windows.some((window) =>
      timeWindowMatches(window.startMinute, window.endMinute, bookingMinute),
    )
    if (!allowed) return false
  }

  return true
}

function entitlementHasBalance(entitlement: EntitlementWithPlan) {
  if (entitlement.type === MembershipPlanType.TIME_PACK) {
    return (entitlement.remainingMinutes ?? 0) > 0
  }
  if (entitlement.type === MembershipPlanType.SESSION_PACK) {
    return (entitlement.remainingSessions ?? 0) > 0
  }
  if (entitlement.type === MembershipPlanType.WALLET_TOPUP) {
    return (entitlement.walletBalance ?? 0) > 0
  }
  return false
}

function resolveBalanceLabel(entitlement: EntitlementWithPlan) {
  if (entitlement.plan?.name?.trim()) return entitlement.plan.name.trim()
  if (entitlement.type === MembershipPlanType.TIME_PACK) return 'Time pack'
  if (entitlement.type === MembershipPlanType.SESSION_PACK) return 'Session pack'
  if (entitlement.type === MembershipPlanType.WALLET_TOPUP) return 'Wallet'
  return 'Membership'
}

function toEstimatedBalance(entitlement: EntitlementWithPlan) {
  return {
    entitlementId: entitlement.id,
    type: entitlement.type,
    remainingMinutes: entitlement.remainingMinutes,
    remainingSessions: entitlement.remainingSessions,
    walletBalance: entitlement.walletBalance,
    validTo: entitlement.validTo,
  }
}

function sortEntitlements(a: EntitlementWithPlan, b: EntitlementWithPlan) {
  const aExpiresAt = a.validTo?.getTime() ?? Number.MAX_SAFE_INTEGER
  const bExpiresAt = b.validTo?.getTime() ?? Number.MAX_SAFE_INTEGER
  if (aExpiresAt !== bExpiresAt) return aExpiresAt - bExpiresAt
  return a.createdAt.getTime() - b.createdAt.getTime()
}

function requireNonEmptyString(value: string | null | undefined, field: string) {
  const normalized = (value || '').trim()
  if (!normalized) {
    throw new MembershipFlowError('VALIDATION_ERROR', 400, `${field} is required.`)
  }
  return normalized
}

async function ensureCustomerInClub(
  tx: Prisma.TransactionClient,
  params: { clubId: string; customerId: string },
) {
  const customer = await tx.customer.findFirst({
    where: {
      id: params.customerId,
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
  return customer
}

export async function listMembershipPlans(params: {
  clubId: string
  includeInactive?: boolean
  onlyClientVisible?: boolean
}) {
  const where: Prisma.MembershipPlanWhereInput = {
    clubId: params.clubId,
  }

  if (!params.includeInactive) {
    where.status = MembershipPlanStatus.ACTIVE
  }
  if (params.onlyClientVisible) {
    where.isClientVisible = true
  }

  return prisma.membershipPlan.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function createMembershipPlan(params: {
  clubId: string
  actorUserId: string
  type: MembershipPlanType
  name: string
  description?: string | null
  priceAmount: number
  currency: string
  valueAmount: number
  billingPeriod?: 'WEEKLY' | 'MONTHLY' | null
  eligibilityJson?: string | null
  timeRestrictionsJson?: string | null
  expiryPolicyJson?: string | null
  isClientVisible?: boolean
  isHostVisible?: boolean
  allowStacking?: boolean
}) {
  const name = requireNonEmptyString(params.name, 'name').slice(0, 120)
  const currency = requireNonEmptyString(params.currency, 'currency').toUpperCase().slice(0, 8)

  if (!Number.isInteger(params.priceAmount) || params.priceAmount < 0) {
    throw new MembershipFlowError('VALIDATION_ERROR', 400, 'priceAmount must be >= 0.')
  }
  if (!Number.isInteger(params.valueAmount) || params.valueAmount < 0) {
    throw new MembershipFlowError('VALIDATION_ERROR', 400, 'valueAmount must be >= 0.')
  }

  const created = await prisma.membershipPlan.create({
    data: {
      clubId: params.clubId,
      type: params.type,
      status: MembershipPlanStatus.DRAFT,
      name,
      description: params.description?.trim() || null,
      priceAmount: params.priceAmount,
      currency,
      valueAmount: params.valueAmount,
      billingPeriod: params.billingPeriod || null,
      eligibilityJson: params.eligibilityJson || null,
      timeRestrictionsJson: params.timeRestrictionsJson || null,
      expiryPolicyJson: params.expiryPolicyJson || null,
      isClientVisible: params.isClientVisible ?? true,
      isHostVisible: params.isHostVisible ?? true,
      allowStacking: params.allowStacking ?? true,
      createdByUserId: params.actorUserId,
      updatedByUserId: params.actorUserId,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: 'membership.plan_created',
      entityType: 'membership_plan',
      entityId: created.id,
      metadata: JSON.stringify({
        type: created.type,
        status: created.status,
      }),
    },
  })

  return created
}

export async function updateMembershipPlan(params: {
  clubId: string
  actorUserId: string
  planId: string
  type?: MembershipPlanType
  name?: string
  description?: string | null
  priceAmount?: number
  currency?: string
  valueAmount?: number
  billingPeriod?: 'WEEKLY' | 'MONTHLY' | null
  eligibilityJson?: string | null
  timeRestrictionsJson?: string | null
  expiryPolicyJson?: string | null
  isClientVisible?: boolean
  isHostVisible?: boolean
  allowStacking?: boolean
}) {
  const existing = await prisma.membershipPlan.findFirst({
    where: { id: params.planId, clubId: params.clubId },
    select: { id: true },
  })
  if (!existing) {
    throw new MembershipFlowError('NOT_FOUND', 404, 'Plan was not found.')
  }

  const patch: Prisma.MembershipPlanUncheckedUpdateInput = {
    updatedByUserId: params.actorUserId,
  }

  if (params.type) patch.type = params.type
  if (params.name !== undefined) patch.name = requireNonEmptyString(params.name, 'name').slice(0, 120)
  if (params.description !== undefined) patch.description = params.description?.trim() || null
  if (params.priceAmount !== undefined) {
    if (!Number.isInteger(params.priceAmount) || params.priceAmount < 0) {
      throw new MembershipFlowError('VALIDATION_ERROR', 400, 'priceAmount must be >= 0.')
    }
    patch.priceAmount = params.priceAmount
  }
  if (params.currency !== undefined) {
    patch.currency = requireNonEmptyString(params.currency, 'currency').toUpperCase().slice(0, 8)
  }
  if (params.valueAmount !== undefined) {
    if (!Number.isInteger(params.valueAmount) || params.valueAmount < 0) {
      throw new MembershipFlowError('VALIDATION_ERROR', 400, 'valueAmount must be >= 0.')
    }
    patch.valueAmount = params.valueAmount
  }
  if (params.billingPeriod !== undefined) patch.billingPeriod = params.billingPeriod || null
  if (params.eligibilityJson !== undefined) patch.eligibilityJson = params.eligibilityJson || null
  if (params.timeRestrictionsJson !== undefined) {
    patch.timeRestrictionsJson = params.timeRestrictionsJson || null
  }
  if (params.expiryPolicyJson !== undefined) patch.expiryPolicyJson = params.expiryPolicyJson || null
  if (params.isClientVisible !== undefined) patch.isClientVisible = asBoolean(params.isClientVisible)
  if (params.isHostVisible !== undefined) patch.isHostVisible = asBoolean(params.isHostVisible)
  if (params.allowStacking !== undefined) patch.allowStacking = asBoolean(params.allowStacking)

  const updated = await prisma.membershipPlan.update({
    where: { id: existing.id },
    data: patch,
  })

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: 'membership.plan_updated',
      entityType: 'membership_plan',
      entityId: updated.id,
    },
  })

  return updated
}

export async function setMembershipPlanStatus(params: {
  clubId: string
  actorUserId: string
  planId: string
  status: MembershipPlanStatus
}) {
  const existing = await prisma.membershipPlan.findFirst({
    where: { id: params.planId, clubId: params.clubId },
    select: { id: true, status: true },
  })
  if (!existing) {
    throw new MembershipFlowError('NOT_FOUND', 404, 'Plan was not found.')
  }

  const updated = await prisma.membershipPlan.update({
    where: { id: existing.id },
    data: {
      status: params.status,
      updatedByUserId: params.actorUserId,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action:
        params.status === MembershipPlanStatus.ACTIVE
          ? 'membership.plan_activated'
          : 'membership.plan_deactivated',
      entityType: 'membership_plan',
      entityId: updated.id,
      metadata: JSON.stringify({
        previousStatus: existing.status,
        nextStatus: params.status,
      }),
    },
  })

  return updated
}

export async function listUserMembershipSnapshot(params: {
  clubId: string
  userId: string
}) {
  const now = new Date()
  const [entitlements, transactions, plans] = await Promise.all([
    prisma.membershipEntitlement.findMany({
      where: {
        clubId: params.clubId,
        userId: params.userId,
      },
      include: {
        plan: true,
      },
      orderBy: [{ status: 'asc' }, { validTo: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.membershipTransaction.findMany({
      where: {
        clubId: params.clubId,
        userId: params.userId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    }),
    prisma.membershipPlan.findMany({
      where: {
        clubId: params.clubId,
        status: MembershipPlanStatus.ACTIVE,
        isClientVisible: true,
      },
      orderBy: [{ name: 'asc' }],
    }),
  ])

  const shapedEntitlements = entitlements.map((item) => {
    const computedStatus = computeEntitlementStatus({
      type: item.type,
      remainingMinutes: item.remainingMinutes,
      remainingSessions: item.remainingSessions,
      walletBalance: item.walletBalance,
      validTo: item.validTo,
      now,
    })

    return {
      entitlementId: item.id,
      clubId: item.clubId,
      planId: item.planId,
      type: item.type,
      status: item.status,
      computedStatus,
      remainingMinutes: item.remainingMinutes,
      remainingSessions: item.remainingSessions,
      walletBalance: item.walletBalance,
      validFrom: item.validFrom,
      validTo: item.validTo,
      autoRenew: item.autoRenew,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      metadata: readJsonObject(item.metadataJson),
      plan: item.plan
        ? {
            planId: item.plan.id,
            name: item.plan.name,
            status: item.plan.status,
            type: item.plan.type,
            priceAmount: item.plan.priceAmount,
            currency: item.plan.currency,
            valueAmount: item.plan.valueAmount,
          }
        : null,
    }
  })

  return {
    entitlements: shapedEntitlements,
    transactions: transactions.map((item) => ({
      txId: item.id,
      entitlementId: item.entitlementId,
      txType: item.txType,
      amountDelta: item.amountDelta,
      minutesDelta: item.minutesDelta,
      sessionsDelta: item.sessionsDelta,
      bookingId: item.bookingId,
      paymentId: item.paymentId,
      reason: item.reason,
      metadata: readJsonObject(item.metadataJson),
      createdAt: item.createdAt,
    })),
    availablePlans: plans.map((item) => ({
      planId: item.id,
      type: item.type,
      status: item.status,
      name: item.name,
      description: item.description,
      priceAmount: item.priceAmount,
      currency: item.currency,
      valueAmount: item.valueAmount,
      billingPeriod: item.billingPeriod,
      isClientVisible: item.isClientVisible,
      isHostVisible: item.isHostVisible,
    })),
  }
}

export async function listCustomerMembershipSnapshot(params: {
  clubId: string
  customerId: string
}) {
  const [entitlements, transactions] = await Promise.all([
    prisma.membershipEntitlement.findMany({
      where: {
        clubId: params.clubId,
        customerId: params.customerId,
      },
      include: {
        plan: true,
      },
      orderBy: [{ status: 'asc' }, { validTo: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.membershipTransaction.findMany({
      where: {
        clubId: params.clubId,
        customerId: params.customerId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    }),
  ])

  return {
    entitlements: entitlements.map((item) => ({
      entitlementId: item.id,
      planId: item.planId,
      type: item.type,
      status: item.status,
      remainingMinutes: item.remainingMinutes,
      remainingSessions: item.remainingSessions,
      walletBalance: item.walletBalance,
      validFrom: item.validFrom,
      validTo: item.validTo,
      plan: item.plan
        ? {
            planId: item.plan.id,
            name: item.plan.name,
            type: item.plan.type,
          }
        : null,
    })),
    transactions: transactions.map((item) => ({
      txId: item.id,
      entitlementId: item.entitlementId,
      txType: item.txType,
      amountDelta: item.amountDelta,
      minutesDelta: item.minutesDelta,
      sessionsDelta: item.sessionsDelta,
      bookingId: item.bookingId,
      reason: item.reason,
      createdAt: item.createdAt,
    })),
  }
}

async function loadApplicableEntitlements(params: {
  tx: Prisma.TransactionClient
  clubId: string
  now: Date
  userId?: string | null
  customerId?: string | null
  entitlementId?: string | null
}) {
  const ownershipFilters: Prisma.MembershipEntitlementWhereInput[] = []
  if (params.userId) ownershipFilters.push({ userId: params.userId })
  if (params.customerId) ownershipFilters.push({ customerId: params.customerId })

  if (ownershipFilters.length === 0 && !params.entitlementId) {
    return [] as EntitlementWithPlan[]
  }

  const where: Prisma.MembershipEntitlementWhereInput = {
    clubId: params.clubId,
    status: MembershipEntitlementStatus.ACTIVE,
    validFrom: { lte: params.now },
    OR: [{ validTo: null }, { validTo: { gt: params.now } }],
  }

  if (params.entitlementId) {
    where.id = params.entitlementId
  }

  if (ownershipFilters.length > 0) {
    where.AND = [{ OR: ownershipFilters }]
  }

  const entitlements = await params.tx.membershipEntitlement.findMany({
    where,
    include: {
      plan: true,
    },
    orderBy: [{ validTo: 'asc' }, { createdAt: 'asc' }],
  })

  if (params.entitlementId && entitlements.length === 0) {
    throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
  }

  return entitlements as EntitlementWithPlan[]
}

function cloneEntitlements(entitlements: EntitlementWithPlan[]) {
  return entitlements.map((item) => ({
    ...item,
    plan: item.plan ? { ...item.plan } : null,
  }))
}

function applyWallet(
  entitlement: EntitlementWithPlan,
  remainingDue: number,
  applied: MembershipAppliedLine[],
) {
  const available = entitlement.walletBalance ?? 0
  if (available <= 0 || remainingDue <= 0) return remainingDue

  const consumed = Math.min(available, remainingDue)
  entitlement.walletBalance = available - consumed
  applied.push({
    entitlementId: entitlement.id,
    planId: entitlement.planId,
    type: entitlement.type,
    label: resolveBalanceLabel(entitlement),
    amountCovered: consumed,
    minutesConsumed: 0,
    sessionsConsumed: 0,
    walletConsumed: consumed,
  })

  return remainingDue - consumed
}

function applySessionPack(
  entitlement: EntitlementWithPlan,
  remainingDue: number,
  context: EligibilityContext,
  applied: MembershipAppliedLine[],
) {
  const available = entitlement.remainingSessions ?? 0
  if (available <= 0 || remainingDue <= 0) return remainingDue
  if (!entitlementEligibleForContext(entitlement, context)) return remainingDue

  entitlement.remainingSessions = available - 1
  applied.push({
    entitlementId: entitlement.id,
    planId: entitlement.planId,
    type: entitlement.type,
    label: resolveBalanceLabel(entitlement),
    amountCovered: remainingDue,
    minutesConsumed: 0,
    sessionsConsumed: 1,
    walletConsumed: 0,
  })

  return 0
}

function applyTimePack(
  entitlement: EntitlementWithPlan,
  remainingDue: number,
  baseTotal: number,
  duration: number,
  context: EligibilityContext,
  applied: MembershipAppliedLine[],
) {
  const available = entitlement.remainingMinutes ?? 0
  if (available <= 0 || remainingDue <= 0) return remainingDue
  if (!entitlementEligibleForContext(entitlement, context)) return remainingDue

  const ratePerMinute = baseTotal / Math.max(1, duration)
  if (ratePerMinute <= 0) return remainingDue

  const neededMinutes = Math.ceil(remainingDue / ratePerMinute)
  const consumedMinutes = Math.min(available, Math.max(1, neededMinutes))
  let covered = Math.round(consumedMinutes * ratePerMinute)
  covered = Math.min(remainingDue, Math.max(1, covered))

  entitlement.remainingMinutes = available - consumedMinutes
  applied.push({
    entitlementId: entitlement.id,
    planId: entitlement.planId,
    type: entitlement.type,
    label: resolveBalanceLabel(entitlement),
    amountCovered: covered,
    minutesConsumed: consumedMinutes,
    sessionsConsumed: 0,
    walletConsumed: 0,
  })

  return remainingDue - covered
}

function applyMembershipAdjustments(params: {
  entitlements: EntitlementWithPlan[]
  baseTotal: number
  startAt: Date
  endAt: Date
  segmentId?: string | null
  roomId?: number | null
  seatId?: string | null
  preference: MembershipPaymentPreference
  entitlementId?: string | null
  useWallet?: boolean
}) {
  const entitlementId = params.entitlementId?.trim() || null
  const entitlements = cloneEntitlements(params.entitlements).sort(sortEntitlements)
  const context: EligibilityContext = {
    segmentId: params.segmentId,
    roomId: params.roomId,
    seatId: params.seatId,
    startAt: params.startAt,
    endAt: params.endAt,
  }

  let due = Math.max(0, Math.round(params.baseTotal))
  const duration = durationMinutes(params.startAt, params.endAt)
  const applied: MembershipAppliedLine[] = []

  const preferred = normalizePreference(params.preference)
  if (preferred === 'CASH') {
    return {
      remainingDue: due,
      applied,
      entitlements,
      preference: preferred,
    }
  }

  let primaryEntitlement: EntitlementWithPlan | null = null
  if (entitlementId) {
    primaryEntitlement = entitlements.find((item) => item.id === entitlementId) || null
    if (!primaryEntitlement) {
      throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
    }
  }

  const usableWallets = entitlements.filter(
    (item) => item.type === MembershipPlanType.WALLET_TOPUP && entitlementHasBalance(item),
  )

  const usablePacks = entitlements.filter(
    (item) =>
      (item.type === MembershipPlanType.TIME_PACK || item.type === MembershipPlanType.SESSION_PACK) &&
      entitlementHasBalance(item),
  )

  const applySpecificEntitlement = (entitlement: EntitlementWithPlan, currentDue: number) => {
    if (entitlement.type === MembershipPlanType.WALLET_TOPUP) {
      return applyWallet(entitlement, currentDue, applied)
    }
    if (entitlement.type === MembershipPlanType.SESSION_PACK) {
      return applySessionPack(entitlement, currentDue, context, applied)
    }
    if (entitlement.type === MembershipPlanType.TIME_PACK) {
      return applyTimePack(entitlement, currentDue, params.baseTotal, duration, context, applied)
    }
    return currentDue
  }

  const applyFirstUsablePack = (currentDue: number) => {
    if (currentDue <= 0) return currentDue
    if (primaryEntitlement) {
      if (
        primaryEntitlement.type === MembershipPlanType.TIME_PACK ||
        primaryEntitlement.type === MembershipPlanType.SESSION_PACK
      ) {
        return applySpecificEntitlement(primaryEntitlement, currentDue)
      }
      return currentDue
    }

    for (const entitlement of usablePacks) {
      const nextDue = applySpecificEntitlement(entitlement, currentDue)
      if (nextDue < currentDue) return nextDue
    }
    return currentDue
  }

  const applyWallets = (currentDue: number) => {
    if (currentDue <= 0) return currentDue
    if (!params.useWallet) return currentDue

    if (primaryEntitlement?.type === MembershipPlanType.WALLET_TOPUP) {
      return applySpecificEntitlement(primaryEntitlement, currentDue)
    }

    let nextDue = currentDue
    for (const wallet of usableWallets) {
      nextDue = applyWallet(wallet, nextDue, applied)
      if (nextDue <= 0) break
    }
    return nextDue
  }

  if (preferred === 'WALLET_FIRST') {
    due = applyWallets(due)
    due = applyFirstUsablePack(due)
  } else {
    due = applyFirstUsablePack(due)
    due = applyWallets(due)
  }

  return {
    remainingDue: Math.max(0, due),
    applied,
    entitlements,
    preference: preferred,
  }
}

export async function applyMembershipToQuote(params: {
  clubId: string
  userId?: string | null
  customerId?: string | null
  entitlementId?: string | null
  useWallet?: boolean
  paymentPreference?: MembershipPaymentPreference
  baseTotal: number
  currency: string
  startAt: Date
  endAt: Date
  segmentId?: string | null
  roomId?: number | null
  seatId?: string | null
}) {
  const now = new Date()
  const tx = prisma
  const entitlements = await loadApplicableEntitlements({
    tx: tx as unknown as Prisma.TransactionClient,
    clubId: params.clubId,
    now,
    userId: params.userId,
    customerId: params.customerId,
    entitlementId: params.entitlementId,
  })

  const applied = applyMembershipAdjustments({
    entitlements,
    baseTotal: params.baseTotal,
    startAt: params.startAt,
    endAt: params.endAt,
    segmentId: params.segmentId,
    roomId: params.roomId,
    seatId: params.seatId,
    preference: normalizePreference(params.paymentPreference),
    entitlementId: params.entitlementId,
    useWallet: params.useWallet,
  })

  return {
    baseTotal: params.baseTotal,
    remainingDue: applied.remainingDue,
    currency: params.currency,
    preference: applied.preference,
    applied: applied.applied,
    estimatedBalances: applied.entitlements.map((item) => toEstimatedBalance(item)),
  } satisfies MembershipQuotePreview
}

async function createLedgerEntry(
  tx: Prisma.TransactionClient,
  params: {
    clubId: string
    entitlementId: string
    planId: string | null
    customerId: string | null
    userId: string | null
    bookingId: number | null
    paymentId: number | null
    txType: MembershipTransactionType
    amountDelta?: number
    minutesDelta?: number
    sessionsDelta?: number
    createdByUserId: string | null
    createdByRole: MembershipActorRole
    reason?: string | null
    metadata?: Record<string, unknown>
  },
) {
  return tx.membershipTransaction.create({
    data: {
      clubId: params.clubId,
      entitlementId: params.entitlementId,
      planId: params.planId,
      customerId: params.customerId,
      userId: params.userId,
      bookingId: params.bookingId,
      paymentId: params.paymentId,
      txType: params.txType,
      amountDelta: params.amountDelta ?? 0,
      minutesDelta: params.minutesDelta ?? 0,
      sessionsDelta: params.sessionsDelta ?? 0,
      createdByUserId: params.createdByUserId,
      createdByRole: params.createdByRole,
      reason: params.reason?.trim() || null,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

async function applyConsumptionLine(
  tx: Prisma.TransactionClient,
  params: {
    now: Date
    line: MembershipAppliedLine
    bookingId: number
    clubId: string
    actorUserId: string | null
    actorRole: MembershipActorRole
  },
) {
  const entitlement = await tx.membershipEntitlement.findUnique({
    where: { id: params.line.entitlementId },
    select: {
      id: true,
      clubId: true,
      type: true,
      status: true,
      remainingMinutes: true,
      remainingSessions: true,
      walletBalance: true,
      validTo: true,
      planId: true,
      customerId: true,
      userId: true,
    },
  })
  if (!entitlement || entitlement.clubId !== params.clubId) {
    throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
  }
  if (entitlement.status !== MembershipEntitlementStatus.ACTIVE) {
    throw new MembershipFlowError(
      'ENTITLEMENT_NOT_ACTIVE',
      409,
      'Entitlement is not active.',
    )
  }

  if (params.line.walletConsumed > 0) {
    const updated = await tx.membershipEntitlement.updateMany({
      where: {
        id: entitlement.id,
        status: MembershipEntitlementStatus.ACTIVE,
        walletBalance: { gte: params.line.walletConsumed },
      },
      data: {
        walletBalance: { decrement: params.line.walletConsumed },
      },
    })
    if (updated.count === 0) {
      throw new MembershipFlowError(
        'ENTITLEMENT_INSUFFICIENT_BALANCE',
        409,
        'Insufficient wallet balance.',
      )
    }
  }

  if (params.line.minutesConsumed > 0) {
    const updated = await tx.membershipEntitlement.updateMany({
      where: {
        id: entitlement.id,
        status: MembershipEntitlementStatus.ACTIVE,
        remainingMinutes: { gte: params.line.minutesConsumed },
      },
      data: {
        remainingMinutes: { decrement: params.line.minutesConsumed },
      },
    })
    if (updated.count === 0) {
      throw new MembershipFlowError(
        'ENTITLEMENT_INSUFFICIENT_BALANCE',
        409,
        'Insufficient remaining minutes.',
      )
    }
  }

  if (params.line.sessionsConsumed > 0) {
    const updated = await tx.membershipEntitlement.updateMany({
      where: {
        id: entitlement.id,
        status: MembershipEntitlementStatus.ACTIVE,
        remainingSessions: { gte: params.line.sessionsConsumed },
      },
      data: {
        remainingSessions: { decrement: params.line.sessionsConsumed },
      },
    })
    if (updated.count === 0) {
      throw new MembershipFlowError(
        'ENTITLEMENT_INSUFFICIENT_BALANCE',
        409,
        'Insufficient remaining sessions.',
      )
    }
  }

  const refreshed = await tx.membershipEntitlement.findUnique({
    where: { id: entitlement.id },
    select: {
      id: true,
      type: true,
      remainingMinutes: true,
      remainingSessions: true,
      walletBalance: true,
      validTo: true,
      status: true,
    },
  })

  if (!refreshed) {
    throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
  }

  const nextStatus = computeEntitlementStatus({
    type: refreshed.type,
    remainingMinutes: refreshed.remainingMinutes,
    remainingSessions: refreshed.remainingSessions,
    walletBalance: refreshed.walletBalance,
    validTo: refreshed.validTo,
    now: params.now,
  })

  if (refreshed.status !== nextStatus) {
    await tx.membershipEntitlement.update({
      where: { id: refreshed.id },
      data: { status: nextStatus },
    })
  }

  await createLedgerEntry(tx, {
    clubId: params.clubId,
    entitlementId: entitlement.id,
    planId: entitlement.planId,
    customerId: entitlement.customerId,
    userId: entitlement.userId,
    bookingId: params.bookingId,
    paymentId: null,
    txType: MembershipTransactionType.CONSUME,
    amountDelta: -params.line.walletConsumed,
    minutesDelta: -params.line.minutesConsumed,
    sessionsDelta: -params.line.sessionsConsumed,
    createdByUserId: params.actorUserId,
    createdByRole: params.actorRole,
    reason: 'booking.confirm',
    metadata: {
      amountCovered: params.line.amountCovered,
      label: params.line.label,
    },
  })
}

export async function consumeMembershipForBooking(params: {
  tx: Prisma.TransactionClient
  booking: {
    id: number
    clubId: string | null
    customerId: string | null
    clientUserId: string | null
    checkIn: Date
    checkOut: Date
    priceTotalCents: number | null
    priceCurrency: string | null
    membershipConsumptionJson: string | null
  }
  selection?: MembershipSelectionInput | null
  segmentId?: string | null
  roomId?: number | null
  seatId?: string | null
  actorUserId: string | null
  actorRole: MembershipActorRole
}) {
  const clubId = params.booking.clubId
  if (!clubId) return null

  const selection = params.selection || null
  const preference = normalizePreference(selection?.paymentPreference)
  const useWallet = selection?.useWallet === true
  const explicitEntitlementId = selection?.entitlementId?.trim() || null

  if (!explicitEntitlementId && !useWallet) return null
  if (preference === 'CASH') return null

  const existingConsumeTx = await params.tx.membershipTransaction.findFirst({
    where: {
      bookingId: params.booking.id,
      txType: MembershipTransactionType.CONSUME,
    },
    select: { id: true },
  })

  if (existingConsumeTx) {
    if (!params.booking.membershipConsumptionJson) return null
    try {
      return JSON.parse(params.booking.membershipConsumptionJson) as BookingMembershipConsumption
    } catch {
      return null
    }
  }

  const total = Math.max(0, params.booking.priceTotalCents ?? 0)
  if (total <= 0) return null

  const now = new Date()
  const entitlements = await loadApplicableEntitlements({
    tx: params.tx,
    clubId,
    now,
    userId: params.booking.clientUserId,
    customerId: params.booking.customerId,
    entitlementId: explicitEntitlementId,
  })

  if (entitlements.length === 0) {
    if (explicitEntitlementId) {
      throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
    }
    return null
  }

  const preview = applyMembershipAdjustments({
    entitlements,
    baseTotal: total,
    startAt: params.booking.checkIn,
    endAt: params.booking.checkOut,
    segmentId: params.segmentId,
    roomId: params.roomId,
    seatId: params.seatId,
    preference,
    entitlementId: explicitEntitlementId,
    useWallet,
  })

  if (preview.applied.length === 0) {
    return null
  }

  for (const line of preview.applied) {
    await applyConsumptionLine(params.tx, {
      now,
      line,
      bookingId: params.booking.id,
      clubId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
    })
  }

  const consumption: BookingMembershipConsumption = {
    baseTotal: total,
    remainingDue: preview.remainingDue,
    currency: params.booking.priceCurrency,
    preference: preview.preference,
    applied: preview.applied,
    appliedAt: now.toISOString(),
  }

  await params.tx.booking.update({
    where: { id: params.booking.id },
    data: {
      membershipConsumptionJson: JSON.stringify(consumption),
      membershipReversedAt: null,
      paymentStatus: preview.remainingDue === 0 ? PaymentStatus.PAID : undefined,
    },
  })

  return consumption
}

async function reverseConsumptionLine(
  tx: Prisma.TransactionClient,
  params: {
    now: Date
    line: MembershipAppliedLine
    bookingId: number
    clubId: string
    actorUserId: string | null
    actorRole: MembershipActorRole
  },
) {
  const entitlement = await tx.membershipEntitlement.findUnique({
    where: { id: params.line.entitlementId },
    select: {
      id: true,
      clubId: true,
      type: true,
      status: true,
      remainingMinutes: true,
      remainingSessions: true,
      walletBalance: true,
      validTo: true,
      planId: true,
      customerId: true,
      userId: true,
    },
  })

  if (!entitlement || entitlement.clubId !== params.clubId) {
    return
  }

  await tx.membershipEntitlement.update({
    where: { id: entitlement.id },
    data: {
      walletBalance:
        params.line.walletConsumed > 0
          ? { increment: params.line.walletConsumed }
          : undefined,
      remainingMinutes:
        params.line.minutesConsumed > 0
          ? { increment: params.line.minutesConsumed }
          : undefined,
      remainingSessions:
        params.line.sessionsConsumed > 0
          ? { increment: params.line.sessionsConsumed }
          : undefined,
    },
  })

  const refreshed = await tx.membershipEntitlement.findUnique({
    where: { id: entitlement.id },
    select: {
      id: true,
      type: true,
      remainingMinutes: true,
      remainingSessions: true,
      walletBalance: true,
      validTo: true,
      status: true,
    },
  })

  if (refreshed) {
    const nextStatus = computeEntitlementStatus({
      type: refreshed.type,
      remainingMinutes: refreshed.remainingMinutes,
      remainingSessions: refreshed.remainingSessions,
      walletBalance: refreshed.walletBalance,
      validTo: refreshed.validTo,
      now: params.now,
    })
    if (nextStatus !== refreshed.status) {
      await tx.membershipEntitlement.update({
        where: { id: refreshed.id },
        data: { status: nextStatus },
      })
    }
  }

  await createLedgerEntry(tx, {
    clubId: params.clubId,
    entitlementId: entitlement.id,
    planId: entitlement.planId,
    customerId: entitlement.customerId,
    userId: entitlement.userId,
    bookingId: params.bookingId,
    paymentId: null,
    txType: MembershipTransactionType.REFUND,
    amountDelta: params.line.walletConsumed,
    minutesDelta: params.line.minutesConsumed,
    sessionsDelta: params.line.sessionsConsumed,
    createdByUserId: params.actorUserId,
    createdByRole: params.actorRole,
    reason: 'booking.cancel',
    metadata: {
      amountCovered: params.line.amountCovered,
      label: params.line.label,
    },
  })
}

export async function reverseMembershipConsumptionForBooking(params: {
  tx: Prisma.TransactionClient
  booking: {
    id: number
    clubId: string | null
    membershipConsumptionJson: string | null
    membershipReversedAt: Date | null
  }
  actorUserId: string | null
  actorRole: MembershipActorRole
}) {
  const clubId = params.booking.clubId
  if (!clubId) return null
  if (!params.booking.membershipConsumptionJson) return null
  if (params.booking.membershipReversedAt) return null

  let parsed: BookingMembershipConsumption | null = null
  try {
    parsed = JSON.parse(params.booking.membershipConsumptionJson) as BookingMembershipConsumption
  } catch {
    parsed = null
  }

  if (!parsed || !Array.isArray(parsed.applied) || parsed.applied.length === 0) {
    return null
  }

  const now = new Date()
  for (const line of parsed.applied) {
    await reverseConsumptionLine(params.tx, {
      now,
      line,
      bookingId: params.booking.id,
      clubId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
    })
  }

  await params.tx.booking.update({
    where: { id: params.booking.id },
    data: {
      membershipReversedAt: now,
    },
  })

  return {
    reversedAt: now,
    lines: parsed.applied.length,
  }
}

export async function purchaseMembershipPlan(params: {
  clubId: string
  planId: string
  paymentMode: PurchaseMode
  actorUserId: string
  actorRole: MembershipActorRole
  userId?: string | null
  customerId?: string | null
}) {
  if (params.paymentMode === 'ONLINE') {
    throw new MembershipFlowError(
      'PAYMENT_ONLINE_NOT_AVAILABLE',
      409,
      'Online membership purchase is not enabled yet.',
    )
  }

  return prisma.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.findFirst({
      where: {
        id: params.planId,
        clubId: params.clubId,
      },
    })
    if (!plan || plan.status !== MembershipPlanStatus.ACTIVE) {
      throw new MembershipFlowError('NOT_FOUND', 404, 'Plan was not found or inactive.')
    }

    let customerId = params.customerId?.trim() || null
    let userId = params.userId?.trim() || null

    if (customerId) {
      const customer = await ensureCustomerInClub(tx, {
        clubId: params.clubId,
        customerId,
      })
      if (!userId && customer.linkedUserId) {
        userId = customer.linkedUserId
      }
    }

    if (!customerId && !userId) {
      throw new MembershipFlowError(
        'VALIDATION_ERROR',
        400,
        'customerId or userId is required to purchase membership.',
      )
    }

    const purchasedAt = new Date()
    const validTo = parseExpiryPolicy(plan.expiryPolicyJson, purchasedAt)

    const ownerWhere: Prisma.MembershipEntitlementWhereInput = {
      clubId: params.clubId,
      type: plan.type,
      status: MembershipEntitlementStatus.ACTIVE,
      userId,
      customerId,
      OR: [{ validTo: null }, { validTo: { gt: purchasedAt } }],
    }

    let entitlement = null as EntitlementWithPlan | null
    if (plan.type === MembershipPlanType.WALLET_TOPUP || !plan.allowStacking) {
      entitlement = (await tx.membershipEntitlement.findFirst({
        where: ownerWhere,
        include: { plan: true },
        orderBy: [{ validTo: 'asc' }, { createdAt: 'asc' }],
      })) as EntitlementWithPlan | null
    }

    if (!entitlement) {
      entitlement = (await tx.membershipEntitlement.create({
        data: {
          clubId: params.clubId,
          customerId,
          userId,
          planId: plan.id,
          type: plan.type,
          status: MembershipEntitlementStatus.ACTIVE,
          remainingMinutes: plan.type === MembershipPlanType.TIME_PACK ? plan.valueAmount : null,
          remainingSessions:
            plan.type === MembershipPlanType.SESSION_PACK ? plan.valueAmount : null,
          walletBalance: plan.type === MembershipPlanType.WALLET_TOPUP ? plan.valueAmount : null,
          validFrom: purchasedAt,
          validTo,
          autoRenew: false,
        },
        include: { plan: true },
      })) as EntitlementWithPlan
    } else {
      const patch: Prisma.MembershipEntitlementUpdateInput = {
        validTo: validTo ?? entitlement.validTo,
        remainingMinutes:
          plan.type === MembershipPlanType.TIME_PACK
            ? { increment: plan.valueAmount }
            : undefined,
        remainingSessions:
          plan.type === MembershipPlanType.SESSION_PACK
            ? { increment: plan.valueAmount }
            : undefined,
        walletBalance:
          plan.type === MembershipPlanType.WALLET_TOPUP
            ? { increment: plan.valueAmount }
            : undefined,
      }

      entitlement = (await tx.membershipEntitlement.update({
        where: { id: entitlement.id },
        data: patch,
        include: { plan: true },
      })) as EntitlementWithPlan
    }

    await createLedgerEntry(tx, {
      clubId: params.clubId,
      entitlementId: entitlement.id,
      planId: plan.id,
      customerId,
      userId,
      bookingId: null,
      paymentId: null,
      txType: MembershipTransactionType.PURCHASE,
      amountDelta: plan.type === MembershipPlanType.WALLET_TOPUP ? plan.valueAmount : 0,
      minutesDelta: plan.type === MembershipPlanType.TIME_PACK ? plan.valueAmount : 0,
      sessionsDelta: plan.type === MembershipPlanType.SESSION_PACK ? plan.valueAmount : 0,
      createdByUserId: params.actorUserId,
      createdByRole: params.actorRole,
      reason: 'membership.purchase',
      metadata: {
        paymentMode: params.paymentMode,
        planPriceAmount: plan.priceAmount,
        planCurrency: plan.currency,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'membership.purchased',
        entityType: 'membership_entitlement',
        entityId: entitlement.id,
        metadata: JSON.stringify({
          planId: plan.id,
          type: plan.type,
          paymentMode: params.paymentMode,
          userId,
          customerId,
        }),
      },
    })

    return {
      entitlementId: entitlement.id,
      clubId: entitlement.clubId,
      planId: entitlement.planId,
      type: entitlement.type,
      status: entitlement.status,
      remainingMinutes: entitlement.remainingMinutes,
      remainingSessions: entitlement.remainingSessions,
      walletBalance: entitlement.walletBalance,
      validFrom: entitlement.validFrom,
      validTo: entitlement.validTo,
      plan: {
        planId: plan.id,
        name: plan.name,
        type: plan.type,
        valueAmount: plan.valueAmount,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
      },
    }
  })
}

export async function adjustMembershipEntitlement(params: {
  clubId: string
  entitlementId: string
  actorUserId: string
  actorRole: MembershipActorRole
  minutesDelta?: number
  sessionsDelta?: number
  amountDelta?: number
  reason: string
}) {
  const reason = requireNonEmptyString(params.reason, 'reason').slice(0, 500)
  const minutesDelta = Math.trunc(params.minutesDelta ?? 0)
  const sessionsDelta = Math.trunc(params.sessionsDelta ?? 0)
  const amountDelta = Math.trunc(params.amountDelta ?? 0)

  if (minutesDelta === 0 && sessionsDelta === 0 && amountDelta === 0) {
    throw new MembershipFlowError('VALIDATION_ERROR', 400, 'At least one delta must be non-zero.')
  }

  return prisma.$transaction(async (tx) => {
    const entitlement = await tx.membershipEntitlement.findFirst({
      where: {
        id: params.entitlementId,
        clubId: params.clubId,
      },
      select: {
        id: true,
        clubId: true,
        type: true,
        status: true,
        remainingMinutes: true,
        remainingSessions: true,
        walletBalance: true,
        validTo: true,
        customerId: true,
        userId: true,
        planId: true,
      },
    })

    if (!entitlement) {
      throw new MembershipFlowError('NOT_FOUND', 404, 'Entitlement was not found.')
    }

    if (entitlement.type === MembershipPlanType.TIME_PACK && (sessionsDelta !== 0 || amountDelta !== 0)) {
      throw new MembershipFlowError(
        'VALIDATION_ERROR',
        400,
        'Time pack supports only minutesDelta adjustment.',
      )
    }
    if (
      entitlement.type === MembershipPlanType.SESSION_PACK &&
      (minutesDelta !== 0 || amountDelta !== 0)
    ) {
      throw new MembershipFlowError(
        'VALIDATION_ERROR',
        400,
        'Session pack supports only sessionsDelta adjustment.',
      )
    }
    if (
      entitlement.type === MembershipPlanType.WALLET_TOPUP &&
      (minutesDelta !== 0 || sessionsDelta !== 0)
    ) {
      throw new MembershipFlowError(
        'VALIDATION_ERROR',
        400,
        'Wallet entitlement supports only amountDelta adjustment.',
      )
    }

    const nextMinutes = (entitlement.remainingMinutes ?? 0) + minutesDelta
    const nextSessions = (entitlement.remainingSessions ?? 0) + sessionsDelta
    const nextWallet = (entitlement.walletBalance ?? 0) + amountDelta

    if (nextMinutes < 0 || nextSessions < 0 || nextWallet < 0) {
      throw new MembershipFlowError('VALIDATION_ERROR', 409, 'Adjustment exceeds available balance.')
    }

    const now = new Date()
    const nextStatus = computeEntitlementStatus({
      type: entitlement.type,
      remainingMinutes:
        entitlement.type === MembershipPlanType.TIME_PACK ? nextMinutes : entitlement.remainingMinutes,
      remainingSessions:
        entitlement.type === MembershipPlanType.SESSION_PACK
          ? nextSessions
          : entitlement.remainingSessions,
      walletBalance:
        entitlement.type === MembershipPlanType.WALLET_TOPUP ? nextWallet : entitlement.walletBalance,
      validTo: entitlement.validTo,
      now,
    })

    const updated = await tx.membershipEntitlement.update({
      where: { id: entitlement.id },
      data: {
        remainingMinutes:
          entitlement.type === MembershipPlanType.TIME_PACK ? nextMinutes : entitlement.remainingMinutes,
        remainingSessions:
          entitlement.type === MembershipPlanType.SESSION_PACK
            ? nextSessions
            : entitlement.remainingSessions,
        walletBalance:
          entitlement.type === MembershipPlanType.WALLET_TOPUP ? nextWallet : entitlement.walletBalance,
        status: nextStatus,
      },
    })

    await createLedgerEntry(tx, {
      clubId: params.clubId,
      entitlementId: entitlement.id,
      planId: entitlement.planId,
      customerId: entitlement.customerId,
      userId: entitlement.userId,
      bookingId: null,
      paymentId: null,
      txType: MembershipTransactionType.ADJUST,
      amountDelta,
      minutesDelta,
      sessionsDelta,
      createdByUserId: params.actorUserId,
      createdByRole: params.actorRole,
      reason,
      metadata: {
        previousStatus: entitlement.status,
        nextStatus,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'membership.adjusted',
        entityType: 'membership_entitlement',
        entityId: entitlement.id,
        metadata: JSON.stringify({
          minutesDelta,
          sessionsDelta,
          amountDelta,
          reason,
        }),
      },
    })

    return {
      entitlementId: updated.id,
      type: updated.type,
      status: updated.status,
      remainingMinutes: updated.remainingMinutes,
      remainingSessions: updated.remainingSessions,
      walletBalance: updated.walletBalance,
      validFrom: updated.validFrom,
      validTo: updated.validTo,
      updatedAt: updated.updatedAt,
    }
  })
}
