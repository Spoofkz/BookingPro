import { BookingStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, parseDateOrNull, parsePage } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  redactPii,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

function parseStatus(value: string | null) {
  if (!value) return null
  if (value === BookingStatus.HELD) return value
  if (value === BookingStatus.PENDING) return value
  if (value === BookingStatus.CONFIRMED) return value
  if (value === BookingStatus.CHECKED_IN) return value
  if (value === BookingStatus.CANCELED) return value
  if (value === BookingStatus.COMPLETED) return value
  if (value === BookingStatus.NO_SHOW) return value
  return null
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.BOOKINGS_READ)
    const searchParams = request.nextUrl.searchParams
    const bookingId = Number(searchParams.get('bookingId') || '')
    const clubId = searchParams.get('clubId')?.trim()
    const status = parseStatus(searchParams.get('status'))
    const q = searchParams.get('q')?.trim()
    const dateFrom = parseDateOrNull(searchParams.get('dateFrom'))
    const dateTo = parseDateOrNull(searchParams.get('dateTo'))
    if (searchParams.get('dateFrom') && !dateFrom) {
      return NextResponse.json({ error: 'dateFrom is invalid.' }, { status: 400 })
    }
    if (searchParams.get('dateTo') && !dateTo) {
      return NextResponse.json({ error: 'dateTo is invalid.' }, { status: 400 })
    }

    const { page, pageSize, skip } = parsePage(searchParams)
    const where: Record<string, unknown> = {}
    if (Number.isInteger(bookingId) && bookingId > 0) where.id = bookingId
    if (clubId) where.clubId = clubId
    if (status) where.status = status
    if (q) {
      where.OR = [
        { guestName: { contains: q } },
        { guestEmail: { contains: q } },
        { guestPhone: { contains: q } },
      ]
    }
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      }
    }

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          club: { select: { id: true, name: true, slug: true } },
          room: { select: { id: true, name: true } },
          client: { select: { id: true, name: true, email: true, phone: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { id: true, amountCents: true, status: true, method: true, createdAt: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.booking.count({ where }),
    ])

    return NextResponse.json({
      items: items.map((booking) => {
        const guest = redactPii({ phone: booking.guestPhone, email: booking.guestEmail }, admin)
        return {
          bookingId: booking.id,
          clubId: booking.clubId,
          clubName: booking.club?.name ?? null,
          roomId: booking.roomId,
          roomName: booking.room.name,
          slotId: booking.slotId,
          seatId: booking.seatId,
          guestName: booking.guestName,
          guestPhone: guest.phone,
          guestEmail: guest.email,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          priceTotalCents: booking.priceTotalCents,
          createdAt: booking.createdAt,
          payments: booking.payments,
        }
      }),
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

