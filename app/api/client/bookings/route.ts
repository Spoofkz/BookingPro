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

    return NextResponse.json({ items, page, pageSize, total })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
