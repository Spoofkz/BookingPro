import { BookingStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { parseStatusFilter } from '@/src/lib/clientOwnership'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function parseIsoDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const searchParams = request.nextUrl.searchParams
    const statuses = parseStatusFilter(searchParams.get('status'))
    const clubId = searchParams.get('clubId')?.trim() || null
    const from = parseIsoDate(searchParams.get('from'))
    const to = parseIsoDate(searchParams.get('to'))

    const where: {
      OR: Array<Record<string, string>>
      status?: { in: BookingStatus[] }
      clubId?: string
      checkIn?: { gte?: Date; lte?: Date }
    } = {
      OR: [{ clientUserId: context.userId }],
    }
    if (context.profile.email) {
      where.OR.push({ guestEmail: context.profile.email.toLowerCase() })
    }
    if (statuses.length) {
      where.status = { in: statuses }
    }
    if (clubId) {
      where.clubId = clubId
    }
    if (from || to) {
      where.checkIn = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      }
    }

    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
    const skip = (page - 1) * pageSize

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          room: {
            select: {
              id: true,
              name: true,
              slug: true,
              segmentId: true,
              segment: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          club: {
            select: {
              id: true,
              name: true,
              slug: true,
              address: true,
              city: true,
            },
          },
        },
        orderBy: [{ checkIn: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.booking.count({ where }),
    ])

    const clubIds = Array.from(
      new Set(items.map((item) => item.clubId).filter((value): value is string => Boolean(value))),
    )
    const latestMapVersions = clubIds.length
      ? await prisma.seatMapVersion.findMany({
          where: { clubId: { in: clubIds } },
          orderBy: [{ clubId: 'asc' }, { versionNumber: 'desc' }, { publishedAt: 'desc' }],
          select: { clubId: true, id: true },
        })
      : []

    const latestVersionByClubId = new Map<string, string>()
    for (const row of latestMapVersions) {
      if (!latestVersionByClubId.has(row.clubId)) {
        latestVersionByClubId.set(row.clubId, row.id)
      }
    }

    const seatIdsByClubId = new Map<string, Set<string>>()
    for (const booking of items) {
      if (!booking.clubId) continue
      if (!booking.seatId) continue
      if (!latestVersionByClubId.has(booking.clubId)) continue
      const set = seatIdsByClubId.get(booking.clubId) ?? new Set<string>()
      set.add(booking.seatId)
      seatIdsByClubId.set(booking.clubId, set)
    }

    const seatSegmentByClubSeat = new Map<string, string>()
    for (const [clubIdKey, seatIds] of seatIdsByClubId.entries()) {
      const mapVersionId = latestVersionByClubId.get(clubIdKey)
      if (!mapVersionId || seatIds.size < 1) continue
      const rows = await prisma.seatIndex.findMany({
        where: {
          clubId: clubIdKey,
          mapVersionId,
          seatId: { in: Array.from(seatIds) },
        },
        select: {
          seatId: true,
          segmentId: true,
        },
      })
      for (const row of rows) {
        seatSegmentByClubSeat.set(`${clubIdKey}:${row.seatId}`, row.segmentId)
      }
    }

    const rawSegmentIds = Array.from(
      new Set(
        items
          .flatMap((booking) => {
            if (!booking.clubId) return [booking.room?.segmentId ?? null]
            const fromSeat = booking.seatId
              ? seatSegmentByClubSeat.get(`${booking.clubId}:${booking.seatId}`) ?? null
              : null
            return [fromSeat, booking.room?.segmentId ?? null]
          }),
      ),
    )
    const segmentIds = rawSegmentIds.filter((value): value is string => Boolean(value))
    const segmentRows = segmentIds.length
      ? await prisma.segment.findMany({
          where: { id: { in: segmentIds } },
          select: { id: true, name: true },
        })
      : []
    const segmentNameById = new Map(segmentRows.map((segment) => [segment.id, segment.name]))

    const normalizedItems = items.map((booking) => {
      if (!booking.clubId) {
        return {
          ...booking,
          seatSegment: null,
        }
      }
      const seatSegmentId = booking.seatId
        ? seatSegmentByClubSeat.get(`${booking.clubId}:${booking.seatId}`) ?? null
        : null
      const segmentId = seatSegmentId || booking.room?.segmentId || null
      const segmentName =
        (segmentId ? segmentNameById.get(segmentId) : null) ||
        booking.room?.segment?.name ||
        null
      return {
        ...booking,
        seatSegment: segmentId
          ? {
              segmentId,
              segmentName,
            }
          : null,
      }
    })

    return NextResponse.json({ items: normalizedItems, page, pageSize, total })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
