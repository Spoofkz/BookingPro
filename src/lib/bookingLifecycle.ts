import { BookingStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

type DbClient = PrismaClient | Prisma.TransactionClient

export function activeBookingStatuses() {
  return [
    BookingStatus.HELD,
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
  ] as const
}

export function seatBlockingBookingStatuses() {
  return [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] as const
}

export function isOperationalBookingStatus(status: BookingStatus) {
  return status === BookingStatus.CONFIRMED || status === BookingStatus.CHECKED_IN
}

export async function completeElapsedBookings(params?: {
  db?: DbClient
  clubId?: string
  now?: Date
}) {
  const db = params?.db ?? prisma
  const now = params?.now ?? new Date()
  const result = await db.booking.updateMany({
    where: {
      clubId: params?.clubId,
      status: {
        in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
      },
      checkOut: {
        lte: now,
      },
    },
    data: {
      status: BookingStatus.COMPLETED,
      checkedOutAt: now,
    },
  })
  return result.count
}

