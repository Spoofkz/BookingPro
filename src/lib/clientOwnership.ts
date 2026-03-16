import { Booking, BookingStatus } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export class ClientOwnershipError extends Error {
  status: number

  constructor(message: string, status = 404) {
    super(message)
    this.status = status
  }
}

export function parseBookingId(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

export function canClientAccessBooking(
  booking: Pick<Booking, 'clientUserId' | 'guestEmail'>,
  currentUserId: string,
  currentEmail: string | null,
) {
  if (booking.clientUserId && booking.clientUserId === currentUserId) return true
  if (currentEmail && booking.guestEmail.toLowerCase() === currentEmail.toLowerCase()) return true
  return false
}

export async function requireOwnedBooking(params: {
  bookingId: number
  userId: string
  email: string | null
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      room: {
        include: {
          segment: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      slot: true,
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
          city: true,
          area: true,
          timezone: true,
          currency: true,
          cancellationPolicyJson: true,
          reschedulePolicyJson: true,
        },
      },
      payments: {
        orderBy: [{ createdAt: 'desc' }],
      },
    },
  })

  if (!booking) {
    throw new ClientOwnershipError('Booking not found.', 404)
  }

  const allowed = canClientAccessBooking(booking, params.userId, params.email)
  if (!allowed) {
    throw new ClientOwnershipError('Booking not found.', 404)
  }

  return booking
}

export function parseStatusFilter(value: string | null): BookingStatus[] {
  if (!value) return []
  const statuses = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const allowed = new Set<BookingStatus>()
  for (const status of statuses) {
    if (status === BookingStatus.HELD) allowed.add(BookingStatus.HELD)
    if (status === BookingStatus.PENDING) allowed.add(BookingStatus.PENDING)
    if (status === BookingStatus.CONFIRMED) allowed.add(BookingStatus.CONFIRMED)
    if (status === BookingStatus.CHECKED_IN) allowed.add(BookingStatus.CHECKED_IN)
    if (status === BookingStatus.CANCELED) allowed.add(BookingStatus.CANCELED)
    if (status === BookingStatus.COMPLETED) allowed.add(BookingStatus.COMPLETED)
    if (status === BookingStatus.NO_SHOW) allowed.add(BookingStatus.NO_SHOW)
  }
  return [...allowed]
}
