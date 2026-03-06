import { SlotStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import {
  DEFAULT_BOOKING_LEAD_TIME_MINUTES,
  addDaysLocalDate,
  startOfLocalDateUtc,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseDateOnly(value: string | null) {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

function parseDateTime(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true, timezone: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  let isStaff = false
  try {
    const context = await getCabinetContext()
    isStaff = canAccessClub(context, clubId)
  } catch {
    isStaff = false
  }

  const date = parseDateOnly(request.nextUrl.searchParams.get('date'))
  const from = parseDateTime(request.nextUrl.searchParams.get('from'))
  const to = parseDateTime(request.nextUrl.searchParams.get('to'))
  if (request.nextUrl.searchParams.get('date') && !date) {
    return NextResponse.json({ error: 'date must be in YYYY-MM-DD format.' }, { status: 400 })
  }
  if (request.nextUrl.searchParams.get('from') && !from) {
    return NextResponse.json({ error: 'from must be a valid ISO datetime.' }, { status: 400 })
  }
  if (request.nextUrl.searchParams.get('to') && !to) {
    return NextResponse.json({ error: 'to must be a valid ISO datetime.' }, { status: 400 })
  }
  if (from && to && to <= from) {
    return NextResponse.json({ error: 'to must be greater than from.' }, { status: 400 })
  }

  if (!isStaff) {
    const isPublished = normalizeClubStatus(club.status) === CLUB_STATUSES.PUBLISHED
    if (!isPublished) {
      return NextResponse.json({ error: 'Slots are not available.' }, { status: 404 })
    }
    if (!date) {
      return NextResponse.json({ error: 'date is required for public slots endpoint.' }, { status: 400 })
    }
    if (from || to) {
      return NextResponse.json({ error: 'Range queries are staff-only.' }, { status: 403 })
    }
  }

  const where: {
    clubId: string
    status?: SlotStatus | { in: SlotStatus[] }
    localDate?: string
    startAtUtc?: { gte?: Date; lt?: Date }
  } = { clubId }

  if (date) {
    where.localDate = date
  }
  if (from || to) {
    where.startAtUtc = {}
    if (from) where.startAtUtc.gte = from
    if (to) where.startAtUtc.lt = to
  } else if (isStaff && !date) {
    const now = new Date()
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    where.startAtUtc = { gte: now, lt: weekAhead }
  } else if (!isStaff && date) {
    const startUtc = startOfLocalDateUtc(date, club.timezone)
    const nextDate = addDaysLocalDate(date, 1)
    const endUtc = nextDate ? startOfLocalDateUtc(nextDate, club.timezone) : null
    if (startUtc && endUtc) {
      where.startAtUtc = { gte: startUtc, lt: endUtc }
    }
  }

  if (!isStaff) {
    where.status = SlotStatus.PUBLISHED
  }

  const rows = await prisma.slot.findMany({
    where,
    orderBy: [{ startAtUtc: 'asc' }, { endAtUtc: 'asc' }],
    select: {
      id: true,
      startAtUtc: true,
      endAtUtc: true,
      localDate: true,
      status: true,
    },
    take: isStaff ? 1000 : 400,
  })

  let items = rows
  if (!isStaff) {
    const template = await prisma.scheduleTemplate.findUnique({
      where: { clubId },
      select: { bookingLeadTimeMinutes: true },
    })
    const leadMinutes = template?.bookingLeadTimeMinutes ?? DEFAULT_BOOKING_LEAD_TIME_MINUTES
    const threshold = new Date(Date.now() + leadMinutes * 60_000)
    items = rows.filter((row) => row.startAtUtc >= threshold)
  }

  return NextResponse.json({
    items: items.map((row) => ({
      slotId: row.id,
      startAt: row.startAtUtc,
      endAt: row.endAtUtc,
      localDate: row.localDate,
      status: row.status,
    })),
  })
}
