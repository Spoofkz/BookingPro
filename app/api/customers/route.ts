import { BookingStatus, CustomerRecordStatus, Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  isPrismaUniqueViolation,
  maskCustomerEmail,
  maskCustomerPhone,
  normalizeCustomerDisplayName,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerTag,
} from '@/src/lib/customerManagement'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type CreateCustomerBody = {
  displayName?: string
  phone?: string
  email?: string
  linkedUserId?: string | null
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number(value || '')
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(100, Math.max(1, Math.floor(parsed)))
}

function parsePage(value: string | null) {
  const parsed = Number(value || '')
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.floor(parsed))
}

function parseSort(value: string | null) {
  if (value === 'most_bookings') return 'most_bookings' as const
  if (value === 'name') return 'name' as const
  return 'newest_activity' as const
}

function parseStatusFilter(value: string | null) {
  if (value === 'active' || value === 'blocked' || value === 'flagged' || value === 'merged' || value === 'all') {
    return value
  }
  return 'active'
}

function parseNoShowRange(value: string | null) {
  if (value === '0' || value === '1-2' || value === '3+') return value
  return null
}

export async function GET(request: NextRequest) {
  const context = await getCabinetContext()

  let clubId: string | null = null
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_READ)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const q = searchParams.get('q')?.trim() || ''
  const rawTag = searchParams.get('tag')
  const tag = normalizeCustomerTag(rawTag)
  const statusFilter = parseStatusFilter(searchParams.get('status'))
  const hasUpcoming = searchParams.get('hasUpcoming')
  const noShowRange = parseNoShowRange(searchParams.get('noShowRange'))
  const sort = parseSort(searchParams.get('sort'))
  const lastVisitFrom = parseDate(searchParams.get('lastVisitFrom'))
  const lastVisitTo = parseDate(searchParams.get('lastVisitTo'))
  const pageSize = parseLimit(searchParams.get('pageSize') || searchParams.get('limit'), 30)
  const page = parsePage(searchParams.get('page'))

  if (rawTag && !tag) {
    return NextResponse.json({ error: 'tag is invalid.' }, { status: 400 })
  }
  if (searchParams.get('noShowRange') && !noShowRange) {
    return NextResponse.json({ error: 'noShowRange is invalid. Use 0, 1-2, or 3+.' }, { status: 400 })
  }
  if (hasUpcoming != null && hasUpcoming !== 'true' && hasUpcoming !== 'false') {
    return NextResponse.json({ error: 'hasUpcoming must be true or false.' }, { status: 400 })
  }
  if (searchParams.get('lastVisitFrom') && !lastVisitFrom) {
    return NextResponse.json({ error: 'lastVisitFrom is invalid.' }, { status: 400 })
  }
  if (searchParams.get('lastVisitTo') && !lastVisitTo) {
    return NextResponse.json({ error: 'lastVisitTo is invalid.' }, { status: 400 })
  }

  const where: Prisma.CustomerWhereInput = {
    clubId,
    status:
      statusFilter === 'merged'
        ? CustomerRecordStatus.MERGED
        : statusFilter === 'all'
          ? { not: CustomerRecordStatus.DELETED }
          : CustomerRecordStatus.ACTIVE,
  }

  if (statusFilter === 'active') {
    where.isBlocked = false
    where.requiresAttention = false
  } else if (statusFilter === 'blocked') {
    where.isBlocked = true
  } else if (statusFilter === 'flagged') {
    where.requiresAttention = true
  }

  if (tag) {
    where.tags = {
      some: {
        tag,
      },
    }
  }

  if (q) {
    const digits = q.replace(/\D/g, '')
    const normalizedPhone = normalizeCustomerPhone(q)
    const orFilters: Prisma.CustomerWhereInput[] = [
      {
        id: {
          contains: q,
        },
      },
      {
        displayName: {
          contains: q,
        },
      },
      {
        email: {
          contains: q.toLowerCase(),
        },
      },
    ]
    if (normalizedPhone) {
      orFilters.push({ phone: normalizedPhone })
    }
    if (digits.length >= 4) {
      orFilters.push({
        phone: {
          contains: digits,
        },
      })
      if (digits.length === 4) {
        orFilters.push({
          phone: {
            endsWith: digits,
          },
        })
      }
    }
    where.OR = orFilters
  }

  const [candidateCustomers, availableTags] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        phone: true,
        email: true,
        status: true,
        isBlocked: true,
        requiresAttention: true,
        attentionReason: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.customerTag.findMany({
      where: { clubId },
      select: { tag: true },
      distinct: ['tag'],
      orderBy: { tag: 'asc' },
      take: 100,
    }),
  ])

  if (candidateCustomers.length < 1) {
    return NextResponse.json({
      items: [],
      availableTags: availableTags.map((item) => item.tag),
      page,
      pageSize,
      total: 0,
    })
  }

  const candidateCustomerIds = candidateCustomers.map((customer) => customer.id)
  const now = new Date()
  const [bookingTotals, noShowCounts, upcomingCounts, customerTags] = await Promise.all([
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        clubId,
        customerId: { in: candidateCustomerIds },
      },
      _count: { _all: true },
      _max: { checkIn: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        clubId,
        customerId: { in: candidateCustomerIds },
        status: BookingStatus.NO_SHOW,
      },
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ['customerId'],
      where: {
        clubId,
        customerId: { in: candidateCustomerIds },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        checkIn: { gte: now },
      },
      _count: { _all: true },
    }),
    prisma.customerTag.findMany({
      where: {
        clubId,
        customerId: { in: candidateCustomerIds },
      },
      select: {
        customerId: true,
        tag: true,
      },
      orderBy: { tag: 'asc' },
    }),
  ])

  const totalsByCustomerId = new Map<
    string,
    {
      totalBookings: number
      lastVisitAt: Date | null
    }
  >()
  for (const row of bookingTotals) {
    if (!row.customerId) continue
    totalsByCustomerId.set(row.customerId, {
      totalBookings: row._count._all,
      lastVisitAt: row._max.checkIn,
    })
  }

  const noShowByCustomerId = new Map<string, number>()
  for (const row of noShowCounts) {
    if (!row.customerId) continue
    noShowByCustomerId.set(row.customerId, row._count._all)
  }

  const upcomingByCustomerId = new Map<string, number>()
  for (const row of upcomingCounts) {
    if (!row.customerId) continue
    upcomingByCustomerId.set(row.customerId, row._count._all)
  }

  const tagsByCustomerId = new Map<string, string[]>()
  for (const row of customerTags) {
    if (!tagsByCustomerId.has(row.customerId)) {
      tagsByCustomerId.set(row.customerId, [])
    }
    tagsByCustomerId.get(row.customerId)?.push(row.tag)
  }

  const duplicatePhoneCounts = new Map<string, number>()
  const duplicateEmailCounts = new Map<string, number>()
  for (const customer of candidateCustomers) {
    if (customer.phone) {
      duplicatePhoneCounts.set(customer.phone, (duplicatePhoneCounts.get(customer.phone) || 0) + 1)
    }
    if (customer.email) {
      const emailKey = customer.email.toLowerCase()
      duplicateEmailCounts.set(emailKey, (duplicateEmailCounts.get(emailKey) || 0) + 1)
    }
  }

  const hasUpcomingFilter =
    hasUpcoming == null ? null : hasUpcoming === 'true'

  const filteredCustomers = candidateCustomers.filter((customer) => {
    const stats = totalsByCustomerId.get(customer.id)
    const noShowCount = noShowByCustomerId.get(customer.id) || 0
    const upcomingCount = upcomingByCustomerId.get(customer.id) || 0

    if (hasUpcomingFilter === true && upcomingCount < 1) return false
    if (hasUpcomingFilter === false && upcomingCount > 0) return false

    if (noShowRange === '0' && noShowCount !== 0) return false
    if (noShowRange === '1-2' && (noShowCount < 1 || noShowCount > 2)) return false
    if (noShowRange === '3+' && noShowCount < 3) return false

    if (lastVisitFrom || lastVisitTo) {
      const lastVisitAt = stats?.lastVisitAt ?? null
      if (!lastVisitAt) return false
      if (lastVisitFrom && lastVisitAt < lastVisitFrom) return false
      if (lastVisitTo && lastVisitAt > lastVisitTo) return false
    }
    return true
  })

  filteredCustomers.sort((a, b) => {
    if (sort === 'name') {
      const aName = (a.displayName || a.email || a.phone || a.id).toLowerCase()
      const bName = (b.displayName || b.email || b.phone || b.id).toLowerCase()
      return aName.localeCompare(bName)
    }
    if (sort === 'most_bookings') {
      const aBookings = totalsByCustomerId.get(a.id)?.totalBookings || 0
      const bBookings = totalsByCustomerId.get(b.id)?.totalBookings || 0
      if (bBookings !== aBookings) return bBookings - aBookings
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    }
    const aLastVisit = totalsByCustomerId.get(a.id)?.lastVisitAt?.getTime() || 0
    const bLastVisit = totalsByCustomerId.get(b.id)?.lastVisitAt?.getTime() || 0
    if (bLastVisit !== aLastVisit) return bLastVisit - aLastVisit
    return b.updatedAt.getTime() - a.updatedAt.getTime()
  })

  const total = filteredCustomers.length
  const start = (page - 1) * pageSize
  const pagedCustomers = filteredCustomers.slice(start, start + pageSize)

  return NextResponse.json({
    items: pagedCustomers.map((customer) => {
      const stats = totalsByCustomerId.get(customer.id)
      const noShowCount = noShowByCustomerId.get(customer.id) || 0
      const upcomingCount = upcomingByCustomerId.get(customer.id) || 0
      const emailKey = customer.email ? customer.email.toLowerCase() : null
      const possibleDuplicates =
        (customer.phone ? (duplicatePhoneCounts.get(customer.phone) || 0) > 1 : false) ||
        (emailKey ? (duplicateEmailCounts.get(emailKey) || 0) > 1 : false)

      return {
        customerId: customer.id,
        displayName: customer.displayName,
        phone: customer.phone,
        phoneMasked: maskCustomerPhone(customer.phone),
        email: customer.email,
        emailMasked: maskCustomerEmail(customer.email),
        status: customer.status,
        isBlocked: customer.isBlocked,
        requiresAttention: customer.requiresAttention,
        attentionReason: customer.attentionReason,
        lastVisitAt: stats?.lastVisitAt ?? null,
        totalBookings: stats?.totalBookings ?? 0,
        upcomingBookings: upcomingCount,
        noShowCount,
        tags: tagsByCustomerId.get(customer.id) || [],
        possibleDuplicates,
      }
    }),
    availableTags: availableTags.map((item) => item.tag),
    page,
    pageSize,
    total,
  })
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let clubId: string | null = null
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_WRITE)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: CreateCustomerBody
  try {
    body = (await request.json()) as CreateCustomerBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const displayName = normalizeCustomerDisplayName(body.displayName)
  const providedPhone = (body.phone || '').trim()
  const phone = providedPhone ? normalizeCustomerPhone(providedPhone) : null
  const providedEmail = (body.email || '').trim()
  const email = providedEmail ? normalizeCustomerEmail(providedEmail) : null
  const linkedUserId = body.linkedUserId?.trim() || null

  if (providedPhone && !phone) {
    return NextResponse.json({ error: 'phone is invalid.' }, { status: 400 })
  }
  if (providedEmail && !email) {
    return NextResponse.json({ error: 'email is invalid.' }, { status: 400 })
  }
  if (!displayName && !phone && !email && !linkedUserId) {
    return NextResponse.json(
      { error: 'At least one of displayName, phone, email, linkedUserId is required.' },
      { status: 400 },
    )
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let existing = null as Awaited<ReturnType<typeof tx.customer.findUnique>> | null
      if (phone) {
        existing = await tx.customer.findUnique({
          where: {
            clubId_phone: {
              clubId,
              phone,
            },
          },
        })
      }

      if (existing) {
        const updated = await tx.customer.update({
          where: { id: existing.id },
          data: {
            displayName: displayName ?? existing.displayName,
            email: email ?? existing.email,
            linkedUserId: linkedUserId ?? existing.linkedUserId,
            status: CustomerRecordStatus.ACTIVE,
          },
        })
        await tx.auditLog.create({
          data: {
            clubId,
            actorUserId: context.userId,
            action: 'customer.updated',
            entityType: 'customer',
            entityId: updated.id,
            metadata: JSON.stringify({
              source: 'customer.api.create',
              deduplicatedByPhone: true,
            }),
          },
        })
        return { status: 200 as const, customer: updated }
      }

      const created = await tx.customer.create({
        data: {
          clubId,
          displayName,
          phone,
          email,
          linkedUserId,
          createdByUserId: context.userId,
          status: CustomerRecordStatus.ACTIVE,
        },
      })
      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'customer.created',
          entityType: 'customer',
          entityId: created.id,
          metadata: JSON.stringify({
            source: 'customer.api.create',
          }),
        },
      })
      if (linkedUserId) {
        await tx.auditLog.create({
          data: {
            clubId,
            actorUserId: context.userId,
            action: 'customer.linked',
            entityType: 'customer',
            entityId: created.id,
            metadata: JSON.stringify({
              linkedUserId,
              source: 'customer.api.create',
            }),
          },
        })
      }
      return { status: 201 as const, customer: created }
    })

    return NextResponse.json(
      {
        customerId: result.customer.id,
        displayName: result.customer.displayName,
        phone: result.customer.phone,
        email: result.customer.email,
        linkedUserId: result.customer.linkedUserId,
        status: result.customer.status,
      },
      { status: result.status },
    )
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return NextResponse.json(
        {
          code: 'DUPLICATE_PHONE',
          error: 'Customer with this phone already exists in this club.',
        },
        { status: 409 },
      )
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json(
        {
          error: 'linkedUserId is invalid.',
        },
        { status: 400 },
      )
    }
    throw error
  }
}
