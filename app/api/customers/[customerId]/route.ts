import { BookingStatus, CustomerRecordStatus, PaymentStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requireClubMembership,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  isPrismaUniqueViolation,
  maskCustomerEmail,
  maskCustomerPhone,
  normalizeAttentionReason,
  normalizeCustomerDisplayName,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
} from '@/src/lib/customerManagement'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string }>
}

type UpdateCustomerBody = {
  displayName?: string | null
  phone?: string | null
  email?: string | null
  linkedUserId?: string | null
  status?: CustomerRecordStatus
  isBlocked?: boolean
  requiresAttention?: boolean
  attentionReason?: string | null
}

function parseStatus(value: unknown) {
  if (value === CustomerRecordStatus.ACTIVE) return CustomerRecordStatus.ACTIVE
  if (value === CustomerRecordStatus.MERGED) return CustomerRecordStatus.MERGED
  if (value === CustomerRecordStatus.DELETED) return CustomerRecordStatus.DELETED
  return null
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  return undefined
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || '')
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(1, Math.floor(parsed)))
}

function asNullableString(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || null
}

function mapTopKeyByCount(counts: Map<string, number>) {
  let selected: string | null = null
  let selectedCount = -1
  for (const [key, count] of counts.entries()) {
    if (count > selectedCount) {
      selected = key
      selectedCount = count
    }
  }
  return selected
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { customerId } = await routeContext.params
  const context = await getCabinetContext()

  let clubId: string | null = null
  let clubRoles: Role[] = []
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    clubRoles = requireClubMembership(context, clubId)
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_READ)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const canRevealPii =
    clubRoles.includes(Role.TECH_ADMIN) &&
    request.nextUrl.searchParams.get('revealPII') === 'true'
  const visitsPage = parsePositiveInt(request.nextUrl.searchParams.get('visitsPage'), 1, 1000)
  const visitsPageSize = parsePositiveInt(request.nextUrl.searchParams.get('visitsPageSize'), 25, 100)

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      clubId,
      status: { not: CustomerRecordStatus.DELETED },
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          name: true,
        },
      },
      linkedUser: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      tags: {
        select: {
          id: true,
          tag: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { tag: 'asc' }],
      },
    },
  })

  if (!customer) {
    return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
  }

  const now = new Date()
  const [totalBookings, cancelCount, noShowCount, lastVisit, notes, upcomingBookings, pastVisits, paymentsAgg, paidBookingsAgg] = await Promise.all([
    prisma.booking.count({
      where: {
        clubId,
        customerId: customer.id,
      },
    }),
    prisma.booking.count({
      where: {
        clubId,
        customerId: customer.id,
        status: BookingStatus.CANCELED,
      },
    }),
    prisma.booking.count({
      where: {
        clubId,
        customerId: customer.id,
        status: BookingStatus.NO_SHOW,
      },
    }),
    prisma.booking.aggregate({
      where: {
        clubId,
        customerId: customer.id,
      },
      _max: {
        checkIn: true,
      },
    }),
    prisma.customerNote.findMany({
      where: {
        clubId,
        customerId: customer.id,
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.booking.findMany({
      where: {
        clubId,
        customerId: customer.id,
        checkIn: { gte: now },
      },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            segmentId: true,
          },
        },
      },
      orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
    prisma.booking.findMany({
      where: {
        clubId,
        customerId: customer.id,
        OR: [{ checkIn: { lt: now } }, { status: BookingStatus.CANCELED }, { status: BookingStatus.NO_SHOW }],
      },
      include: {
        room: {
          select: {
            id: true,
            name: true,
            segmentId: true,
          },
        },
      },
      orderBy: [{ checkIn: 'desc' }, { createdAt: 'desc' }],
      skip: (visitsPage - 1) * visitsPageSize,
      take: visitsPageSize,
    }),
    prisma.payment.aggregate({
      where: {
        clubId,
        booking: {
          customerId: customer.id,
        },
        status: PaymentStatus.PAID,
      },
      _sum: {
        amountCents: true,
      },
    }),
    prisma.booking.aggregate({
      where: {
        clubId,
        customerId: customer.id,
        paymentStatus: PaymentStatus.PAID,
      },
      _sum: {
        priceTotalCents: true,
      },
    }),
  ])

  const preferredSeatCounts = new Map<string, number>()
  const preferredSegmentCounts = new Map<string, number>()
  for (const visit of [...upcomingBookings, ...pastVisits]) {
    if (visit.status === BookingStatus.CANCELED) continue
    if (visit.seatId) {
      preferredSeatCounts.set(visit.seatId, (preferredSeatCounts.get(visit.seatId) || 0) + 1)
    }
    const segmentId = visit.room.segmentId
    if (segmentId) {
      preferredSegmentCounts.set(segmentId, (preferredSegmentCounts.get(segmentId) || 0) + 1)
    }
  }

  const preferredSeatId = mapTopKeyByCount(preferredSeatCounts)
  const preferredSegmentId = mapTopKeyByCount(preferredSegmentCounts)
  const lastBooking = pastVisits[0] || upcomingBookings[0] || null
  const upcomingBookingsCount = upcomingBookings.length
  const lifetimeSpendCents = paymentsAgg._sum.amountCents ?? paidBookingsAgg._sum.priceTotalCents ?? null

  const duplicateFilters: Array<{ phone?: string; email?: string }> = [
    ...(customer.phone ? [{ phone: customer.phone }] : []),
    ...(customer.email ? [{ email: customer.email }] : []),
  ]
  const possibleDuplicates =
    duplicateFilters.length < 1
      ? 0
      : await prisma.customer.count({
          where: {
            clubId,
            status: { not: CustomerRecordStatus.DELETED },
            id: { not: customer.id },
            OR: duplicateFilters,
          },
        })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'customer.viewed',
      entityType: 'customer',
      entityId: customer.id,
      metadata: JSON.stringify({
        revealPII: canRevealPii,
        visitsPage,
        visitsPageSize,
      }),
    },
  })

  return NextResponse.json({
    customerId: customer.id,
    displayName: customer.displayName,
    phone: canRevealPii ? customer.phone : maskCustomerPhone(customer.phone),
    phoneMasked: maskCustomerPhone(customer.phone),
    email: canRevealPii ? customer.email : maskCustomerEmail(customer.email),
    emailMasked: maskCustomerEmail(customer.email),
    revealPii: canRevealPii,
    status: customer.status,
    isBlocked: customer.isBlocked,
    blockedAt: customer.blockedAt,
    requiresAttention: customer.requiresAttention,
    attentionReason: customer.attentionReason,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    source: customer.createdByUserId ? 'admin_created' : customer.linkedUserId ? 'self_registered' : 'walk_in',
    createdBy: customer.createdByUser
      ? {
          id: customer.createdByUser.id,
          name: customer.createdByUser.name,
        }
      : null,
    possibleDuplicates,
    linkedUser: customer.linkedUser,
    tags: customer.tags.map((item) => ({
      id: item.id,
      tag: item.tag,
      createdAt: item.createdAt,
    })),
    stats: {
      totalBookings,
      upcomingBookingsCount,
      cancelCount,
      noShowCount,
      lifetimeSpendCents,
      lastVisitAt: lastVisit._max.checkIn,
      preferredSegmentId,
      preferredSeatId,
    },
    lastBooking: lastBooking
      ? {
          bookingId: lastBooking.id,
          checkIn: lastBooking.checkIn,
          checkOut: lastBooking.checkOut,
          status: lastBooking.status,
          paymentStatus: lastBooking.paymentStatus,
          seatId: lastBooking.seatId,
          seatLabel: lastBooking.seatLabelSnapshot,
          room: {
            id: lastBooking.room.id,
            name: lastBooking.room.name,
          },
          totalCents: lastBooking.priceTotalCents,
          currency: lastBooking.priceCurrency,
        }
      : null,
    notes: notes.map((note) => ({
      noteId: note.id,
      text: note.text,
      isPinned: note.isPinned,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      createdBy: note.createdByUser
        ? {
            id: note.createdByUser.id,
            name: note.createdByUser.name,
          }
        : null,
    })),
    upcomingVisits: upcomingBookings.map((booking) => ({
      bookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      seatId: booking.seatId,
      seatLabel: booking.seatLabelSnapshot,
      room: {
        id: booking.room.id,
        name: booking.room.name,
      },
      totalCents: booking.priceTotalCents,
      currency: booking.priceCurrency,
      channel: booking.channel,
      customerType: booking.customerType,
    })),
    pastVisitsPage: visitsPage,
    pastVisitsPageSize: visitsPageSize,
    visits: pastVisits.map((booking) => ({
      bookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      seatId: booking.seatId,
      seatLabel: booking.seatLabelSnapshot,
      room: {
        id: booking.room.id,
        name: booking.room.name,
      },
      totalCents: booking.priceTotalCents,
      currency: booking.priceCurrency,
      channel: booking.channel,
      customerType: booking.customerType,
    })),
  })
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { customerId } = await routeContext.params
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

  let body: UpdateCustomerBody
  try {
    body = (await request.json()) as UpdateCustomerBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const parsedDisplayName = body.displayName === undefined ? undefined : normalizeCustomerDisplayName(body.displayName)
  const rawPhone = body.phone === undefined ? undefined : asNullableString(body.phone)
  const parsedPhone = rawPhone === undefined || rawPhone === null ? rawPhone : normalizeCustomerPhone(rawPhone)
  const rawEmail = body.email === undefined ? undefined : asNullableString(body.email)
  const parsedEmail = rawEmail === undefined || rawEmail === null ? rawEmail : normalizeCustomerEmail(rawEmail)
  const linkedUserId = body.linkedUserId === undefined ? undefined : asNullableString(body.linkedUserId)
  const parsedStatus = body.status === undefined ? undefined : parseStatus(body.status)
  const parsedIsBlocked = body.isBlocked === undefined ? undefined : parseBoolean(body.isBlocked)
  const parsedRequiresAttention =
    body.requiresAttention === undefined ? undefined : parseBoolean(body.requiresAttention)
  const parsedAttentionReason =
    body.attentionReason === undefined ? undefined : normalizeAttentionReason(asNullableString(body.attentionReason))

  if (rawPhone !== undefined && rawPhone !== null && !parsedPhone) {
    return NextResponse.json({ error: 'phone is invalid.' }, { status: 400 })
  }
  if (rawEmail !== undefined && rawEmail !== null && !parsedEmail) {
    return NextResponse.json({ error: 'email is invalid.' }, { status: 400 })
  }
  if (body.status !== undefined && !parsedStatus) {
    return NextResponse.json({ error: 'status is invalid.' }, { status: 400 })
  }
  if (body.isBlocked !== undefined && parsedIsBlocked === undefined) {
    return NextResponse.json({ error: 'isBlocked must be boolean.' }, { status: 400 })
  }
  if (body.requiresAttention !== undefined && parsedRequiresAttention === undefined) {
    return NextResponse.json({ error: 'requiresAttention must be boolean.' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({
        where: {
          id: customerId,
          clubId,
        },
      })
      if (!existing) {
        return null
      }

      const updates: {
        displayName?: string | null
        phone?: string | null
        email?: string | null
        linkedUserId?: string | null
        status?: CustomerRecordStatus
        isBlocked?: boolean
        blockedAt?: Date | null
        blockedByUserId?: string | null
        requiresAttention?: boolean
        attentionReason?: string | null
      } = {}
      const changedFields: string[] = []

      if (parsedDisplayName !== undefined && parsedDisplayName !== existing.displayName) {
        updates.displayName = parsedDisplayName
        changedFields.push('displayName')
      }
      if (parsedPhone !== undefined && parsedPhone !== existing.phone) {
        updates.phone = parsedPhone
        changedFields.push('phone')
      }
      if (parsedEmail !== undefined && parsedEmail !== existing.email) {
        updates.email = parsedEmail
        changedFields.push('email')
      }
      if (linkedUserId !== undefined && linkedUserId !== existing.linkedUserId) {
        updates.linkedUserId = linkedUserId
        changedFields.push('linkedUserId')
      }
      if (parsedStatus !== undefined && parsedStatus !== null && parsedStatus !== existing.status) {
        updates.status = parsedStatus
        changedFields.push('status')
      }
      if (parsedIsBlocked !== undefined && parsedIsBlocked !== existing.isBlocked) {
        updates.isBlocked = parsedIsBlocked
        updates.blockedAt = parsedIsBlocked ? new Date() : null
        updates.blockedByUserId = parsedIsBlocked ? context.userId : null
        changedFields.push('isBlocked')
      }
      if (
        parsedRequiresAttention !== undefined &&
        parsedRequiresAttention !== existing.requiresAttention
      ) {
        updates.requiresAttention = parsedRequiresAttention
        if (!parsedRequiresAttention) {
          updates.attentionReason = null
        }
        changedFields.push('requiresAttention')
      }
      if (
        parsedAttentionReason !== undefined &&
        parsedRequiresAttention !== false &&
        parsedAttentionReason !== existing.attentionReason
      ) {
        updates.attentionReason = parsedAttentionReason
        changedFields.push('attentionReason')
      }

      if (changedFields.length === 0) {
        return existing
      }

      const updated = await tx.customer.update({
        where: {
          id: existing.id,
        },
        data: updates,
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'customer.updated',
          entityType: 'customer',
          entityId: updated.id,
          metadata: JSON.stringify({
            changedFields,
          }),
        },
      })

      if (linkedUserId !== undefined && existing.linkedUserId !== linkedUserId) {
        await tx.auditLog.create({
          data: {
            clubId,
            actorUserId: context.userId,
            action: linkedUserId ? 'customer.linked' : 'customer.unlinked',
            entityType: 'customer',
            entityId: updated.id,
            metadata: JSON.stringify({
              previousLinkedUserId: existing.linkedUserId,
              linkedUserId,
            }),
          },
        })
      }

      return updated
    })

    if (!result) {
      return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
    }

    return NextResponse.json({
      customerId: result.id,
      displayName: result.displayName,
      phone: result.phone,
      email: result.email,
      linkedUserId: result.linkedUserId,
      status: result.status,
      isBlocked: result.isBlocked,
      blockedAt: result.blockedAt,
      requiresAttention: result.requiresAttention,
      attentionReason: result.attentionReason,
      updatedAt: result.updatedAt,
    })
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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to update customer.',
      },
      { status: 400 },
    )
  }
}
