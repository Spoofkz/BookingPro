import { BookingStatus, InvoiceStatus, MembershipPlanType, PaymentStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/src/lib/prisma'

const DAY_MS = 24 * 60 * 60 * 1000

const datePartFormatterCache = new Map<string, Intl.DateTimeFormat>()
const hourFormatterCache = new Map<string, Intl.DateTimeFormat>()

export type FinanceRange = {
  from: Date
  to: Date
  timezone: string
  days: number
}

export type FinanceOverview = {
  range: {
    from: string
    to: string
    timezone: string
    days: number
  }
  currency: string
  kpis: {
    grossSalesCents: number
    netSalesCents: number
    collectedCents: number
    outstandingCents: number
    discountCents: number
    avgTicketCents: number
    transactionsCount: number
    cancellationCount: number
    noShowCount: number
    estimatedLostRevenueCents: number
    deferredLiabilityCents: number
  }
  paymentSplit: Array<{
    method: 'CASH' | 'POS' | 'ONLINE' | 'WALLET'
    amountCents: number
    transactions: number
  }>
  hourlyRevenue: Array<{
    hour: number
    amountCents: number
    transactions: number
  }>
  revenueByDay: Array<{
    date: string
    amountCents: number
    transactions: number
  }>
  occupancy: {
    seatCount: number
    seatHoursAvailable: number
    seatHoursBooked: number
    utilizationPct: number
  }
  promoImpact: {
    discountedOrdersCount: number
    discountAmountCents: number
    topPromoCodes: Array<{
      code: string
      uses: number
    }>
  }
}

export type FinanceRevenueBreakdown = {
  groupBy: 'day' | 'hour' | 'segment'
  currency: string
  range: FinanceOverview['range']
  buckets: Array<{
    key: string
    label: string
    amountCents: number
    transactions: number
  }>
}

export type FinanceOccupancyBreakdown = {
  groupBy: 'day' | 'hour'
  range: FinanceOverview['range']
  seatCount: number
  buckets: Array<{
    key: string
    label: string
    seatHoursAvailable: number
    seatHoursBooked: number
    utilizationPct: number
  }>
}

export type FinanceInvoiceSummary = {
  range: FinanceOverview['range']
  currency: string
  totals: {
    documents: number
    invoices: number
    receipts: number
    issuedAmountCents: number
    avgInvoiceCents: number
    paidAmountCents: number
    pendingAmountCents: number
  }
  aging: {
    bucket_1_2_days: number
    bucket_3_7_days: number
    bucket_7_plus_days: number
  }
}

export type FinanceShift = {
  shiftId: string
  status: 'OPEN' | 'CLOSED'
  openedAt: string
  closedAt: string | null
  openedByUserId: string | null
  closedByUserId: string | null
  cashierName: string | null
  terminalLabel: string | null
  note: string | null
  closeNote: string | null
  startingCashCents: number
  expectedCashCents: number
  actualCashCents: number | null
  discrepancyCents: number | null
  requiresOwnerApproval: boolean
  approvedByUserId: string | null
}

export type FinanceShiftList = {
  range: FinanceOverview['range']
  shifts: FinanceShift[]
  openShift: FinanceShift | null
}

export type FinanceLiabilitySummary = {
  asOf: string
  currency: string
  totalDeferredCents: number
  expiringIn7DaysCents: number
  expiringIn30DaysCents: number
  byType: Array<{
    type: MembershipPlanType | 'UNKNOWN'
    deferredCents: number
    entitlements: number
  }>
  weeklyConsumption: {
    amountDelta: number
    minutesDelta: number
    sessionsDelta: number
  }
}

type ForecastScenarioInput = {
  horizonDays: number
  priceChangePct: number
  promoDiscountPct: number
  extendedHoursPct: number
  extraBootcampSessionsPerDay: number
}

export type FinanceForecastPoint = {
  date: string
  expectedRevenueCents: number
  expectedBookings: number
  expectedUtilizationPct: number
  lowRevenueCents: number
  highRevenueCents: number
}

export type FinanceForecast = {
  generatedAt: string
  timezone: string
  currency: string
  horizonDays: number
  scenario: ForecastScenarioInput
  totals: {
    revenueCents: number
    bookings: number
    avgUtilizationPct: number
  }
  points: FinanceForecastPoint[]
}

type ShiftOpenMetadata = {
  startingCashCents: number
  openedAt: string
  cashierName?: string | null
  terminalLabel?: string | null
  note?: string | null
}

type ShiftCloseMetadata = {
  closedAt: string
  actualCashCents: number
  expectedCashCents: number
  discrepancyCents: number
  closeNote?: string | null
  requiresOwnerApproval: boolean
  approvedByUserId?: string | null
}

function toIso(value: Date) {
  return value.toISOString()
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundTo2(value: number) {
  return Math.round(value * 100) / 100
}

function parseDate(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function getDateFormatter(timezone: string) {
  const key = timezone
  const cached = datePartFormatterCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  datePartFormatterCache.set(key, formatter)
  return formatter
}

function getHourFormatter(timezone: string) {
  const key = timezone
  const cached = hourFormatterCache.get(key)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
  })
  hourFormatterCache.set(key, formatter)
  return formatter
}

function getLocalDateKey(value: Date, timezone: string) {
  const parts = getDateFormatter(timezone).formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function getLocalHour(value: Date, timezone: string) {
  const hourText = getHourFormatter(timezone).format(value)
  const asNumber = Number(hourText)
  if (!Number.isInteger(asNumber)) return 0
  return clamp(asNumber, 0, 23)
}

function durationHours(startAt: Date, endAt: Date) {
  const ms = Math.max(0, endAt.getTime() - startAt.getTime())
  return ms / (60 * 60 * 1000)
}

function normalizePaymentMethod(method: string | null | undefined): 'CASH' | 'POS' | 'ONLINE' | 'WALLET' {
  const normalized = (method || '').toUpperCase()
  if (normalized.includes('CASH')) return 'CASH'
  if (normalized.includes('POS') || normalized.includes('TERMINAL')) return 'POS'
  if (normalized.includes('WALLET') || normalized.includes('PACK')) return 'WALLET'
  return 'ONLINE'
}

function parseScenario(input: Partial<ForecastScenarioInput> | null | undefined): ForecastScenarioInput {
  const horizonDays = clamp(Number(input?.horizonDays || 7), 1, 90)
  const priceChangePct = clamp(Number(input?.priceChangePct || 0), -80, 200)
  const promoDiscountPct = clamp(Number(input?.promoDiscountPct || 0), 0, 95)
  const extendedHoursPct = clamp(Number(input?.extendedHoursPct || 0), -50, 200)
  const extraBootcampSessionsPerDay = clamp(Number(input?.extraBootcampSessionsPerDay || 0), 0, 40)
  return {
    horizonDays,
    priceChangePct,
    promoDiscountPct,
    extendedHoursPct,
    extraBootcampSessionsPerDay,
  }
}

export async function resolveFinanceRange(params: {
  clubId: string
  from?: string | null
  to?: string | null
  defaultDays?: number
}) {
  const club = await prisma.club.findUnique({
    where: { id: params.clubId },
    select: {
      id: true,
      timezone: true,
      currency: true,
    },
  })
  if (!club) {
    throw new Error('Club not found.')
  }

  const now = new Date()
  const defaultDays = clamp(Number(params.defaultDays || 30), 1, 365)
  const parsedTo = parseDate(params.to) || now
  const parsedFrom = parseDate(params.from) || new Date(parsedTo.getTime() - defaultDays * DAY_MS)
  const from = parsedFrom <= parsedTo ? parsedFrom : parsedTo
  const to = parsedFrom <= parsedTo ? parsedTo : parsedFrom
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS))

  return {
    club,
    range: {
      from,
      to,
      timezone: club.timezone,
      days,
    } satisfies FinanceRange,
  }
}

async function getSeatCapacity(clubId: string) {
  const latestMapVersion = await prisma.seatMapVersion.findFirst({
    where: { clubId },
    orderBy: [{ publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!latestMapVersion) return 0
  return prisma.seatIndex.count({
    where: {
      clubId,
      mapVersionId: latestMapVersion.id,
      isActive: true,
      isDisabled: false,
    },
  })
}

function estimateEntitlementDeferredCents(input: {
  type: MembershipPlanType
  walletBalance: number | null
  remainingMinutes: number | null
  remainingSessions: number | null
  planPriceAmount: number | null
  planValueAmount: number | null
}) {
  if (input.type === MembershipPlanType.WALLET_TOPUP) {
    return Math.max(0, Number(input.walletBalance || 0))
  }

  if (!input.planPriceAmount || !input.planValueAmount || input.planValueAmount <= 0) {
    return 0
  }

  if (input.type === MembershipPlanType.TIME_PACK && input.remainingMinutes != null) {
    return Math.max(0, Math.round((input.planPriceAmount * input.remainingMinutes) / input.planValueAmount))
  }

  if (input.type === MembershipPlanType.SESSION_PACK && input.remainingSessions != null) {
    return Math.max(0, Math.round((input.planPriceAmount * input.remainingSessions) / input.planValueAmount))
  }

  if (input.type === MembershipPlanType.SUBSCRIPTION) {
    return 0
  }

  return 0
}

export async function getFinanceOverview(params: {
  clubId: string
  from?: string | null
  to?: string | null
}) {
  const { club, range } = await resolveFinanceRange(params)
  const seatCountPromise = getSeatCapacity(club.id)

  const [payments, orders, bookings, slots, entitlements, seatCount] = await Promise.all([
    prisma.payment.findMany({
      where: {
        clubId: club.id,
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
        method: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }],
    }),
    prisma.order.findMany({
      where: {
        clubId: club.id,
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
        discountTotalCents: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        clubId: club.id,
        checkIn: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        checkIn: true,
        checkOut: true,
        priceTotalCents: true,
        promoCode: true,
      },
    }),
    prisma.slot.findMany({
      where: {
        clubId: club.id,
        startAtUtc: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        startAtUtc: true,
        endAtUtc: true,
      },
    }),
    prisma.membershipEntitlement.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        type: true,
        walletBalance: true,
        remainingMinutes: true,
        remainingSessions: true,
        validTo: true,
        plan: {
          select: {
            priceAmount: true,
            valueAmount: true,
          },
        },
      },
    }),
    seatCountPromise,
  ])

  const paidPayments = payments.filter((payment) => payment.status === PaymentStatus.PAID)
  const collectedCents = paidPayments.reduce((sum, payment) => sum + payment.amountCents, 0)

  const validOrderStatuses = new Set(['PAID', 'COMPLETED', 'AWAITING_OFFLINE_PAYMENT'])
  const monetizedOrders = orders.filter((order) => validOrderStatuses.has(order.status))
  const orderBackedNetSalesCents = monetizedOrders.reduce((sum, order) => sum + order.totalCents, 0)
  const discountCents = monetizedOrders.reduce((sum, order) => sum + order.discountTotalCents, 0)

  const outstandingCents = bookings
    .filter((booking) => booking.paymentStatus === PaymentStatus.PENDING)
    .filter((booking) => booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.CHECKED_IN)
    .reduce((sum, booking) => sum + Number(booking.priceTotalCents || 0), 0)
  const paymentBackedNetSalesCents = collectedCents + outstandingCents
  const netSalesCents = Math.max(orderBackedNetSalesCents, paymentBackedNetSalesCents)
  const grossSalesCents = netSalesCents + discountCents

  const cancellationBookings = bookings.filter((booking) => booking.status === BookingStatus.CANCELED)
  const noShowBookings = bookings.filter((booking) => booking.status === BookingStatus.NO_SHOW)
  const cancellationCount = cancellationBookings.length
  const noShowCount = noShowBookings.length
  const estimatedLostRevenueCents = [...cancellationBookings, ...noShowBookings].reduce(
    (sum, booking) => sum + Number(booking.priceTotalCents || 0),
    0,
  )

  const paymentSplitMap = new Map<'CASH' | 'POS' | 'ONLINE' | 'WALLET', { amountCents: number; transactions: number }>()
  const hourlyRevenueMap = new Map<number, { amountCents: number; transactions: number }>()
  const dayRevenueMap = new Map<string, { amountCents: number; transactions: number }>()

  for (const payment of paidPayments) {
    const method = normalizePaymentMethod(payment.method)
    const currentSplit = paymentSplitMap.get(method) ?? { amountCents: 0, transactions: 0 }
    currentSplit.amountCents += payment.amountCents
    currentSplit.transactions += 1
    paymentSplitMap.set(method, currentSplit)

    const hour = getLocalHour(payment.createdAt, range.timezone)
    const currentHour = hourlyRevenueMap.get(hour) ?? { amountCents: 0, transactions: 0 }
    currentHour.amountCents += payment.amountCents
    currentHour.transactions += 1
    hourlyRevenueMap.set(hour, currentHour)

    const date = getLocalDateKey(payment.createdAt, range.timezone)
    const currentDay = dayRevenueMap.get(date) ?? { amountCents: 0, transactions: 0 }
    currentDay.amountCents += payment.amountCents
    currentDay.transactions += 1
    dayRevenueMap.set(date, currentDay)
  }

  const paymentSplit = (['CASH', 'POS', 'ONLINE', 'WALLET'] as const).map((method) => ({
    method,
    amountCents: paymentSplitMap.get(method)?.amountCents || 0,
    transactions: paymentSplitMap.get(method)?.transactions || 0,
  }))

  const hourlyRevenue = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    amountCents: hourlyRevenueMap.get(hour)?.amountCents || 0,
    transactions: hourlyRevenueMap.get(hour)?.transactions || 0,
  }))

  const revenueByDay = Array.from(dayRevenueMap.entries())
    .map(([date, values]) => ({
      date,
      amountCents: values.amountCents,
      transactions: values.transactions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  let seatHoursAvailable = 0
  for (const slot of slots) {
    if (slot.status !== 'PUBLISHED') continue
    seatHoursAvailable += durationHours(slot.startAtUtc, slot.endAtUtc) * seatCount
  }

  let seatHoursBooked = 0
  for (const booking of bookings) {
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.CHECKED_IN &&
      booking.status !== BookingStatus.COMPLETED
    ) {
      continue
    }
    seatHoursBooked += durationHours(booking.checkIn, booking.checkOut)
  }

  let deferredLiabilityCents = 0
  for (const entitlement of entitlements) {
    deferredLiabilityCents += estimateEntitlementDeferredCents({
      type: entitlement.type,
      walletBalance: entitlement.walletBalance,
      remainingMinutes: entitlement.remainingMinutes,
      remainingSessions: entitlement.remainingSessions,
      planPriceAmount: entitlement.plan?.priceAmount ?? null,
      planValueAmount: entitlement.plan?.valueAmount ?? null,
    })
  }

  const promoCodeCounts = new Map<string, number>()
  for (const booking of bookings) {
    const code = booking.promoCode?.trim()
    if (!code) continue
    promoCodeCounts.set(code, (promoCodeCounts.get(code) || 0) + 1)
  }

  const topPromoCodes = Array.from(promoCodeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, uses]) => ({ code, uses }))

  return {
    range: {
      from: toIso(range.from),
      to: toIso(range.to),
      timezone: range.timezone,
      days: range.days,
    },
    currency: club.currency,
    kpis: {
      grossSalesCents,
      netSalesCents,
      collectedCents,
      outstandingCents,
      discountCents,
      avgTicketCents: paidPayments.length > 0 ? Math.round(collectedCents / paidPayments.length) : 0,
      transactionsCount: paidPayments.length,
      cancellationCount,
      noShowCount,
      estimatedLostRevenueCents,
      deferredLiabilityCents,
    },
    paymentSplit,
    hourlyRevenue,
    revenueByDay,
    occupancy: {
      seatCount,
      seatHoursAvailable: roundTo2(seatHoursAvailable),
      seatHoursBooked: roundTo2(seatHoursBooked),
      utilizationPct: seatHoursAvailable > 0 ? roundTo2((seatHoursBooked / seatHoursAvailable) * 100) : 0,
    },
    promoImpact: {
      discountedOrdersCount: monetizedOrders.filter((order) => order.discountTotalCents > 0).length,
      discountAmountCents: discountCents,
      topPromoCodes,
    },
  } satisfies FinanceOverview
}

export async function getFinanceRevenueBreakdown(params: {
  clubId: string
  from?: string | null
  to?: string | null
  groupBy?: string | null
}) {
  const { club, range } = await resolveFinanceRange(params)
  const groupBy = params.groupBy === 'hour' || params.groupBy === 'segment' ? params.groupBy : 'day'

  const payments = await prisma.payment.findMany({
    where: {
      clubId: club.id,
      status: PaymentStatus.PAID,
      createdAt: {
        gte: range.from,
        lte: range.to,
      },
    },
    select: {
      amountCents: true,
      createdAt: true,
      booking: {
        select: {
          room: {
            select: {
              segmentId: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  const segmentIds = Array.from(
    new Set(
      payments
        .map((payment) => payment.booking?.room?.segmentId)
        .filter((value): value is string => Boolean(value)),
    ),
  )
  const segments = segmentIds.length
    ? await prisma.segment.findMany({
        where: {
          clubId: club.id,
          id: { in: segmentIds },
        },
        select: { id: true, name: true },
      })
    : []
  const segmentNameById = new Map(segments.map((segment) => [segment.id, segment.name]))

  const bucketMap = new Map<string, { label: string; amountCents: number; transactions: number }>()

  for (const payment of payments) {
    let key = ''
    let label = ''
    if (groupBy === 'hour') {
      const hour = getLocalHour(payment.createdAt, range.timezone)
      key = String(hour).padStart(2, '0')
      label = `${String(hour).padStart(2, '0')}:00`
    } else if (groupBy === 'segment') {
      const segmentId = payment.booking?.room?.segmentId || 'UNASSIGNED'
      key = segmentId
      label = segmentNameById.get(segmentId) || 'Unassigned'
    } else {
      const date = getLocalDateKey(payment.createdAt, range.timezone)
      key = date
      label = date
    }

    const current = bucketMap.get(key) ?? { label, amountCents: 0, transactions: 0 }
    current.amountCents += payment.amountCents
    current.transactions += 1
    bucketMap.set(key, current)
  }

  const buckets = Array.from(bucketMap.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      amountCents: value.amountCents,
      transactions: value.transactions,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    groupBy,
    currency: club.currency,
    range: {
      from: toIso(range.from),
      to: toIso(range.to),
      timezone: range.timezone,
      days: range.days,
    },
    buckets,
  } satisfies FinanceRevenueBreakdown
}

export async function getFinanceOccupancyBreakdown(params: {
  clubId: string
  from?: string | null
  to?: string | null
  groupBy?: string | null
}) {
  const { range } = await resolveFinanceRange(params)
  const groupBy = params.groupBy === 'hour' ? 'hour' : 'day'
  const seatCount = await getSeatCapacity(params.clubId)

  const [slots, bookings] = await Promise.all([
    prisma.slot.findMany({
      where: {
        clubId: params.clubId,
        startAtUtc: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        startAtUtc: true,
        endAtUtc: true,
        status: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        clubId: params.clubId,
        checkIn: {
          gte: range.from,
          lte: range.to,
        },
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED],
        },
      },
      select: {
        checkIn: true,
        checkOut: true,
      },
    }),
  ])

  const bucketMap = new Map<string, { label: string; seatHoursAvailable: number; seatHoursBooked: number }>()

  for (const slot of slots) {
    if (slot.status !== 'PUBLISHED') continue
    const key =
      groupBy === 'hour'
        ? String(getLocalHour(slot.startAtUtc, range.timezone)).padStart(2, '0')
        : getLocalDateKey(slot.startAtUtc, range.timezone)
    const label = groupBy === 'hour' ? `${key}:00` : key
    const current = bucketMap.get(key) ?? { label, seatHoursAvailable: 0, seatHoursBooked: 0 }
    current.seatHoursAvailable += durationHours(slot.startAtUtc, slot.endAtUtc) * seatCount
    bucketMap.set(key, current)
  }

  for (const booking of bookings) {
    const key =
      groupBy === 'hour'
        ? String(getLocalHour(booking.checkIn, range.timezone)).padStart(2, '0')
        : getLocalDateKey(booking.checkIn, range.timezone)
    const label = groupBy === 'hour' ? `${key}:00` : key
    const current = bucketMap.get(key) ?? { label, seatHoursAvailable: 0, seatHoursBooked: 0 }
    current.seatHoursBooked += durationHours(booking.checkIn, booking.checkOut)
    bucketMap.set(key, current)
  }

  const buckets = Array.from(bucketMap.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      seatHoursAvailable: roundTo2(value.seatHoursAvailable),
      seatHoursBooked: roundTo2(value.seatHoursBooked),
      utilizationPct:
        value.seatHoursAvailable > 0
          ? roundTo2((value.seatHoursBooked / value.seatHoursAvailable) * 100)
          : 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    groupBy,
    range: {
      from: toIso(range.from),
      to: toIso(range.to),
      timezone: range.timezone,
      days: range.days,
    },
    seatCount,
    buckets,
  } satisfies FinanceOccupancyBreakdown
}

export async function getFinanceInvoiceSummary(params: {
  clubId: string
  from?: string | null
  to?: string | null
}) {
  const { club, range } = await resolveFinanceRange(params)
  const now = new Date()

  const [invoices, payments, unpaidBookings] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        clubId: params.clubId,
        issueDate: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        totalCents: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        clubId: params.clubId,
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      select: {
        id: true,
        status: true,
        amountCents: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        clubId: params.clubId,
        paymentStatus: PaymentStatus.PENDING,
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
        },
      },
      select: {
        id: true,
        checkOut: true,
      },
    }),
  ])

  const paidAmountCents = payments
    .filter((payment) => payment.status === PaymentStatus.PAID)
    .reduce((sum, payment) => sum + payment.amountCents, 0)
  const pendingAmountCents = payments
    .filter((payment) => payment.status === PaymentStatus.PENDING)
    .reduce((sum, payment) => sum + payment.amountCents, 0)
  const issuedAmountCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0)
  const invoiceCount = invoices.length

  const aging = {
    bucket_1_2_days: 0,
    bucket_3_7_days: 0,
    bucket_7_plus_days: 0,
  }

  for (const booking of unpaidBookings) {
    const ageDays = Math.floor((now.getTime() - booking.checkOut.getTime()) / DAY_MS)
    if (ageDays >= 1 && ageDays <= 2) aging.bucket_1_2_days += 1
    else if (ageDays >= 3 && ageDays <= 7) aging.bucket_3_7_days += 1
    else if (ageDays > 7) aging.bucket_7_plus_days += 1
  }

  return {
    range: {
      from: toIso(range.from),
      to: toIso(range.to),
      timezone: range.timezone,
      days: range.days,
    },
    currency: club.currency,
    totals: {
      documents: invoices.length + payments.length,
      invoices: invoiceCount,
      receipts: payments.length,
      issuedAmountCents,
      avgInvoiceCents: invoiceCount > 0 ? Math.round(issuedAmountCents / invoiceCount) : 0,
      paidAmountCents,
      pendingAmountCents,
    },
    aging,
  } satisfies FinanceInvoiceSummary
}

function serializeShiftOpenMetadata(payload: ShiftOpenMetadata) {
  return JSON.stringify(payload)
}

function serializeShiftCloseMetadata(payload: ShiftCloseMetadata) {
  return JSON.stringify(payload)
}

function parseShiftOpenMetadata(value: string | null) {
  return parseJson<ShiftOpenMetadata>(value)
}

function parseShiftCloseMetadata(value: string | null) {
  return parseJson<ShiftCloseMetadata>(value)
}

async function computeExpectedCashInRange(params: {
  clubId: string
  from: Date
  to: Date
}) {
  const result = await prisma.payment.aggregate({
    where: {
      clubId: params.clubId,
      status: PaymentStatus.PAID,
      createdAt: {
        gte: params.from,
        lte: params.to,
      },
    },
    _sum: {
      amountCents: true,
    },
  })
  return Number(result._sum.amountCents || 0)
}

async function buildShiftSnapshot(params: {
  clubId: string
  shiftId: string
}) {
  const events = await prisma.auditLog.findMany({
    where: {
      clubId: params.clubId,
      entityType: 'finance_shift',
      entityId: params.shiftId,
      action: {
        in: ['finance.shift.open', 'finance.shift.closed'],
      },
    },
    orderBy: [{ createdAt: 'asc' }],
  })

  const openEvent = events.find((event) => event.action === 'finance.shift.open')
  if (!openEvent) return null
  const closeEvent = events.find((event) => event.action === 'finance.shift.closed')

  const openMeta = parseShiftOpenMetadata(openEvent.metadata)
  if (!openMeta) return null
  const closeMeta = closeEvent ? parseShiftCloseMetadata(closeEvent.metadata) : null

  const openAt = parseDate(openMeta.openedAt) || openEvent.createdAt
  const closeAt = closeMeta ? parseDate(closeMeta.closedAt) || closeEvent?.createdAt || null : null
  const expectedCashCents =
    closeMeta?.expectedCashCents ??
    (await computeExpectedCashInRange({
      clubId: params.clubId,
      from: openAt,
      to: closeAt || new Date(),
    }))

  return {
    shiftId: params.shiftId,
    status: closeMeta ? 'CLOSED' : 'OPEN',
    openedAt: openAt.toISOString(),
    closedAt: closeAt ? closeAt.toISOString() : null,
    openedByUserId: openEvent.actorUserId,
    closedByUserId: closeEvent?.actorUserId || null,
    cashierName: openMeta.cashierName || null,
    terminalLabel: openMeta.terminalLabel || null,
    note: openMeta.note || null,
    closeNote: closeMeta?.closeNote || null,
    startingCashCents: openMeta.startingCashCents,
    expectedCashCents,
    actualCashCents: closeMeta?.actualCashCents ?? null,
    discrepancyCents: closeMeta?.discrepancyCents ?? null,
    requiresOwnerApproval: closeMeta?.requiresOwnerApproval || false,
    approvedByUserId: closeMeta?.approvedByUserId || null,
  } satisfies FinanceShift
}

export async function getFinanceShifts(params: {
  clubId: string
  from?: string | null
  to?: string | null
}) {
  const { range } = await resolveFinanceRange(params)
  const openEvents = await prisma.auditLog.findMany({
    where: {
      clubId: params.clubId,
      entityType: 'finance_shift',
      action: 'finance.shift.open',
      createdAt: {
        gte: range.from,
        lte: range.to,
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  })

  const shifts = (
    await Promise.all(
      openEvents.map((openEvent) =>
        buildShiftSnapshot({
          clubId: params.clubId,
          shiftId: openEvent.entityId,
        }),
      ),
    )
  )
    .filter((shift): shift is FinanceShift => Boolean(shift))
    .sort((a, b) => +new Date(b.openedAt) - +new Date(a.openedAt))

  const openShift = shifts.find((shift) => shift.status === 'OPEN') || null

  return {
    range: {
      from: toIso(range.from),
      to: toIso(range.to),
      timezone: range.timezone,
      days: range.days,
    },
    shifts,
    openShift,
  } satisfies FinanceShiftList
}

export async function openFinanceShift(params: {
  clubId: string
  actorUserId: string
  startingCashCents: number
  cashierName?: string | null
  terminalLabel?: string | null
  note?: string | null
}) {
  const now = new Date()
  const shiftId = `shift_${randomUUID()}`

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: 'finance.shift.open',
      entityType: 'finance_shift',
      entityId: shiftId,
      metadata: serializeShiftOpenMetadata({
        startingCashCents: Math.max(0, Math.trunc(params.startingCashCents)),
        openedAt: now.toISOString(),
        cashierName: params.cashierName || null,
        terminalLabel: params.terminalLabel || null,
        note: params.note || null,
      }),
    },
  })

  return buildShiftSnapshot({
    clubId: params.clubId,
    shiftId,
  })
}

export async function closeFinanceShift(params: {
  clubId: string
  shiftId: string
  actorUserId: string
  actualCashCents: number
  closeNote?: string | null
  actorCanApproveDiscrepancy: boolean
}) {
  const shift = await buildShiftSnapshot({
    clubId: params.clubId,
    shiftId: params.shiftId,
  })
  if (!shift) {
    throw new Error('Shift not found.')
  }
  if (shift.status === 'CLOSED') {
    return shift
  }

  const actualCashCents = Math.max(0, Math.trunc(params.actualCashCents))
  const expectedTotalCents = shift.startingCashCents + shift.expectedCashCents
  const discrepancyCents = actualCashCents - expectedTotalCents
  const requiresOwnerApproval = discrepancyCents !== 0 && !params.actorCanApproveDiscrepancy

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: 'finance.shift.closed',
      entityType: 'finance_shift',
      entityId: params.shiftId,
      metadata: serializeShiftCloseMetadata({
        closedAt: new Date().toISOString(),
        actualCashCents,
        expectedCashCents: shift.expectedCashCents,
        discrepancyCents,
        closeNote: params.closeNote || null,
        requiresOwnerApproval,
        approvedByUserId: params.actorCanApproveDiscrepancy ? params.actorUserId : null,
      }),
    },
  })

  return buildShiftSnapshot({
    clubId: params.clubId,
    shiftId: params.shiftId,
  })
}

export async function getFinanceLiability(params: { clubId: string }) {
  const club = await prisma.club.findUnique({
    where: { id: params.clubId },
    select: {
      id: true,
      timezone: true,
      currency: true,
    },
  })
  if (!club) {
    throw new Error('Club not found.')
  }

  const now = new Date()
  const in7Days = new Date(now.getTime() + 7 * DAY_MS)
  const in30Days = new Date(now.getTime() + 30 * DAY_MS)

  const [entitlements, transactions] = await Promise.all([
    prisma.membershipEntitlement.findMany({
      where: {
        clubId: club.id,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        type: true,
        walletBalance: true,
        remainingMinutes: true,
        remainingSessions: true,
        validTo: true,
        plan: {
          select: {
            priceAmount: true,
            valueAmount: true,
          },
        },
      },
    }),
    prisma.membershipTransaction.aggregate({
      where: {
        clubId: club.id,
        txType: 'CONSUME',
        createdAt: {
          gte: new Date(now.getTime() - 7 * DAY_MS),
          lte: now,
        },
      },
      _sum: {
        amountDelta: true,
        minutesDelta: true,
        sessionsDelta: true,
      },
    }),
  ])

  const byTypeMap = new Map<MembershipPlanType | 'UNKNOWN', { deferredCents: number; entitlements: number }>()
  let totalDeferredCents = 0
  let expiringIn7DaysCents = 0
  let expiringIn30DaysCents = 0

  for (const entitlement of entitlements) {
    const type = entitlement.type || 'UNKNOWN'
    const deferredCents = estimateEntitlementDeferredCents({
      type: entitlement.type,
      walletBalance: entitlement.walletBalance,
      remainingMinutes: entitlement.remainingMinutes,
      remainingSessions: entitlement.remainingSessions,
      planPriceAmount: entitlement.plan?.priceAmount ?? null,
      planValueAmount: entitlement.plan?.valueAmount ?? null,
    })

    totalDeferredCents += deferredCents
    if (entitlement.validTo && entitlement.validTo >= now && entitlement.validTo <= in7Days) {
      expiringIn7DaysCents += deferredCents
    }
    if (entitlement.validTo && entitlement.validTo >= now && entitlement.validTo <= in30Days) {
      expiringIn30DaysCents += deferredCents
    }

    const current = byTypeMap.get(type) ?? { deferredCents: 0, entitlements: 0 }
    current.deferredCents += deferredCents
    current.entitlements += 1
    byTypeMap.set(type, current)
  }

  return {
    asOf: now.toISOString(),
    currency: club.currency,
    totalDeferredCents,
    expiringIn7DaysCents,
    expiringIn30DaysCents,
    byType: Array.from(byTypeMap.entries()).map(([type, data]) => ({
      type,
      deferredCents: data.deferredCents,
      entitlements: data.entitlements,
    })),
    weeklyConsumption: {
      amountDelta: Number(transactions._sum.amountDelta || 0),
      minutesDelta: Number(transactions._sum.minutesDelta || 0),
      sessionsDelta: Number(transactions._sum.sessionsDelta || 0),
    },
  } satisfies FinanceLiabilitySummary
}

function nextDate(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS)
}

function dayOfWeek(date: Date, timezone: string) {
  const key = getLocalDateKey(date, timezone)
  const utcDate = new Date(`${key}T00:00:00.000Z`)
  return utcDate.getUTCDay()
}

export async function runFinanceForecast(params: {
  clubId: string
  actorUserId: string
  scenario?: Partial<ForecastScenarioInput> | null
  saveSnapshot?: boolean
}) {
  const club = await prisma.club.findUnique({
    where: { id: params.clubId },
    select: {
      id: true,
      timezone: true,
      currency: true,
    },
  })
  if (!club) {
    throw new Error('Club not found.')
  }

  const scenario = parseScenario(params.scenario)
  const lookbackFrom = new Date(Date.now() - 56 * DAY_MS)
  const now = new Date()

  const [payments, bookings, occupancy] = await Promise.all([
    prisma.payment.findMany({
      where: {
        clubId: club.id,
        status: PaymentStatus.PAID,
        createdAt: {
          gte: lookbackFrom,
          lte: now,
        },
      },
      select: {
        amountCents: true,
        createdAt: true,
      },
    }),
    prisma.booking.findMany({
      where: {
        clubId: club.id,
        checkIn: {
          gte: lookbackFrom,
          lte: now,
        },
        status: {
          in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED],
        },
      },
      select: {
        id: true,
        checkIn: true,
      },
    }),
    getFinanceOccupancyBreakdown({
      clubId: params.clubId,
      from: lookbackFrom.toISOString(),
      to: now.toISOString(),
      groupBy: 'day',
    }),
  ])

  const revenueByWeekday = new Map<number, { total: number; days: number }>()
  const bookingsByWeekday = new Map<number, { total: number; days: number }>()
  const utilizationByWeekday = new Map<number, { total: number; days: number }>()

  const revenueByDate = new Map<string, number>()
  for (const payment of payments) {
    const dateKey = getLocalDateKey(payment.createdAt, club.timezone)
    revenueByDate.set(dateKey, (revenueByDate.get(dateKey) || 0) + payment.amountCents)
  }
  for (const [dateKey, total] of revenueByDate.entries()) {
    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
    const current = revenueByWeekday.get(weekday) ?? { total: 0, days: 0 }
    current.total += total
    current.days += 1
    revenueByWeekday.set(weekday, current)
  }

  const bookingCountByDate = new Map<string, number>()
  for (const booking of bookings) {
    const dateKey = getLocalDateKey(booking.checkIn, club.timezone)
    bookingCountByDate.set(dateKey, (bookingCountByDate.get(dateKey) || 0) + 1)
  }
  for (const [dateKey, total] of bookingCountByDate.entries()) {
    const weekday = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
    const current = bookingsByWeekday.get(weekday) ?? { total: 0, days: 0 }
    current.total += total
    current.days += 1
    bookingsByWeekday.set(weekday, current)
  }

  for (const bucket of occupancy.buckets) {
    const weekday = new Date(`${bucket.key}T00:00:00.000Z`).getUTCDay()
    const current = utilizationByWeekday.get(weekday) ?? { total: 0, days: 0 }
    current.total += bucket.utilizationPct
    current.days += 1
    utilizationByWeekday.set(weekday, current)
  }

  const points: FinanceForecastPoint[] = []
  for (let index = 0; index < scenario.horizonDays; index += 1) {
    const target = nextDate(now, index + 1)
    const weekday = dayOfWeek(target, club.timezone)
    const baselineRevenue =
      (revenueByWeekday.get(weekday)?.total || 0) / Math.max(1, revenueByWeekday.get(weekday)?.days || 1)
    const baselineBookings =
      (bookingsByWeekday.get(weekday)?.total || 0) / Math.max(1, bookingsByWeekday.get(weekday)?.days || 1)
    const baselineUtil =
      (utilizationByWeekday.get(weekday)?.total || 0) / Math.max(1, utilizationByWeekday.get(weekday)?.days || 1)

    const volumeFactor = 1 + scenario.extendedHoursPct / 100 + scenario.extraBootcampSessionsPerDay * 0.015
    const promoFactor = 1 - scenario.promoDiscountPct / 100
    const priceFactor = 1 + scenario.priceChangePct / 100

    const expectedRevenueCents = Math.max(
      0,
      Math.round(baselineRevenue * volumeFactor * priceFactor * promoFactor),
    )
    const expectedBookings = Math.max(
      0,
      Math.round(baselineBookings * (1 + scenario.extendedHoursPct / 120) + scenario.extraBootcampSessionsPerDay),
    )
    const expectedUtilizationPct = clamp(roundTo2(baselineUtil * (1 + scenario.extendedHoursPct / 120)), 0, 100)

    points.push({
      date: getLocalDateKey(target, club.timezone),
      expectedRevenueCents,
      expectedBookings,
      expectedUtilizationPct,
      lowRevenueCents: Math.max(0, Math.round(expectedRevenueCents * 0.8)),
      highRevenueCents: Math.max(0, Math.round(expectedRevenueCents * 1.2)),
    })
  }

  const forecast = {
    generatedAt: new Date().toISOString(),
    timezone: club.timezone,
    currency: club.currency,
    horizonDays: scenario.horizonDays,
    scenario,
    totals: {
      revenueCents: points.reduce((sum, point) => sum + point.expectedRevenueCents, 0),
      bookings: points.reduce((sum, point) => sum + point.expectedBookings, 0),
      avgUtilizationPct:
        points.length > 0
          ? roundTo2(points.reduce((sum, point) => sum + point.expectedUtilizationPct, 0) / points.length)
          : 0,
    },
    points,
  } satisfies FinanceForecast

  if (params.saveSnapshot !== false) {
    await prisma.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.actorUserId,
        action: 'finance.forecast.run',
        entityType: 'finance_forecast',
        entityId: `forecast_${Date.now()}`,
        metadata: JSON.stringify(forecast),
      },
    })
  }

  return forecast
}

export async function getLatestForecastSnapshots(params: {
  clubId: string
  limit?: number
}) {
  const limit = clamp(Number(params.limit || 5), 1, 20)
  const logs = await prisma.auditLog.findMany({
    where: {
      clubId: params.clubId,
      entityType: 'finance_forecast',
      action: 'finance.forecast.run',
    },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
  })

  return logs
    .map((log) => parseJson<FinanceForecast>(log.metadata))
    .filter((item): item is FinanceForecast => Boolean(item))
}

function csvEscape(value: string | number | null | undefined) {
  const raw = value == null ? '' : String(value)
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replaceAll('"', '""')}"`
}

export function buildCsvFromRows(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const body = rows.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\n')
  return `${header.join(',')}\n${body}`
}

export async function exportFinanceCsv(params: {
  clubId: string
  report: string
  from?: string | null
  to?: string | null
}) {
  const report = (params.report || 'overview').toLowerCase()

  if (report === 'revenue') {
    const data = await getFinanceRevenueBreakdown({
      clubId: params.clubId,
      from: params.from,
      to: params.to,
      groupBy: 'day',
    })
    return buildCsvFromRows(
      ['key', 'label', 'amountCents', 'transactions'],
      data.buckets.map((bucket) => [bucket.key, bucket.label, bucket.amountCents, bucket.transactions]),
    )
  }

  if (report === 'occupancy') {
    const data = await getFinanceOccupancyBreakdown({
      clubId: params.clubId,
      from: params.from,
      to: params.to,
      groupBy: 'day',
    })
    return buildCsvFromRows(
      ['key', 'label', 'seatHoursAvailable', 'seatHoursBooked', 'utilizationPct'],
      data.buckets.map((bucket) => [
        bucket.key,
        bucket.label,
        bucket.seatHoursAvailable,
        bucket.seatHoursBooked,
        bucket.utilizationPct,
      ]),
    )
  }

  if (report === 'invoices') {
    const data = await getFinanceInvoiceSummary({
      clubId: params.clubId,
      from: params.from,
      to: params.to,
    })
    return buildCsvFromRows(
      ['metric', 'value'],
      [
        ['documents', data.totals.documents],
        ['invoices', data.totals.invoices],
        ['receipts', data.totals.receipts],
        ['issuedAmountCents', data.totals.issuedAmountCents],
        ['avgInvoiceCents', data.totals.avgInvoiceCents],
        ['paidAmountCents', data.totals.paidAmountCents],
        ['pendingAmountCents', data.totals.pendingAmountCents],
        ['aging_1_2_days', data.aging.bucket_1_2_days],
        ['aging_3_7_days', data.aging.bucket_3_7_days],
        ['aging_7_plus_days', data.aging.bucket_7_plus_days],
      ],
    )
  }

  if (report === 'shifts') {
    const data = await getFinanceShifts({
      clubId: params.clubId,
      from: params.from,
      to: params.to,
    })
    return buildCsvFromRows(
      [
        'shiftId',
        'status',
        'openedAt',
        'closedAt',
        'startingCashCents',
        'expectedCashCents',
        'actualCashCents',
        'discrepancyCents',
      ],
      data.shifts.map((shift) => [
        shift.shiftId,
        shift.status,
        shift.openedAt,
        shift.closedAt,
        shift.startingCashCents,
        shift.expectedCashCents,
        shift.actualCashCents,
        shift.discrepancyCents,
      ]),
    )
  }

  if (report === 'liability') {
    const data = await getFinanceLiability({ clubId: params.clubId })
    return buildCsvFromRows(
      ['type', 'deferredCents', 'entitlements'],
      data.byType.map((row) => [row.type, row.deferredCents, row.entitlements]),
    )
  }

  if (report === 'forecast') {
    const snapshots = await getLatestForecastSnapshots({ clubId: params.clubId, limit: 1 })
    const forecast = snapshots[0]
    if (!forecast) {
      return buildCsvFromRows(['message'], [['No forecast snapshots found']])
    }
    return buildCsvFromRows(
      ['date', 'expectedRevenueCents', 'expectedBookings', 'expectedUtilizationPct', 'lowRevenueCents', 'highRevenueCents'],
      forecast.points.map((point) => [
        point.date,
        point.expectedRevenueCents,
        point.expectedBookings,
        point.expectedUtilizationPct,
        point.lowRevenueCents,
        point.highRevenueCents,
      ]),
    )
  }

  const data = await getFinanceOverview({
    clubId: params.clubId,
    from: params.from,
    to: params.to,
  })
  return buildCsvFromRows(
    ['metric', 'value'],
    [
      ['grossSalesCents', data.kpis.grossSalesCents],
      ['netSalesCents', data.kpis.netSalesCents],
      ['collectedCents', data.kpis.collectedCents],
      ['outstandingCents', data.kpis.outstandingCents],
      ['discountCents', data.kpis.discountCents],
      ['avgTicketCents', data.kpis.avgTicketCents],
      ['transactionsCount', data.kpis.transactionsCount],
      ['cancellationCount', data.kpis.cancellationCount],
      ['noShowCount', data.kpis.noShowCount],
      ['estimatedLostRevenueCents', data.kpis.estimatedLostRevenueCents],
      ['deferredLiabilityCents', data.kpis.deferredLiabilityCents],
      ['utilizationPct', data.occupancy.utilizationPct],
    ],
  )
}

export function summarizeInvoiceStatus(status: InvoiceStatus) {
  if (status === InvoiceStatus.REFUNDED) return 'REFUNDED'
  if (status === InvoiceStatus.VOID) return 'VOID'
  return 'ISSUED'
}
