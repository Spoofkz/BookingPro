import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  redactPii,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ bookingId: string }> }

export async function GET(_: Request, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.BOOKINGS_READ)
    const { bookingId: rawBookingId } = await routeContext.params
    const bookingId = Number(rawBookingId)
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        club: true,
        room: true,
        slot: true,
        client: { select: { id: true, name: true, email: true, phone: true } },
        customer: { select: { id: true, displayName: true, phone: true, email: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        bookingEvents: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!booking) return NextResponse.json({ error: 'Booking was not found.' }, { status: 404 })

    const [audit, notes] = await Promise.all([
      prisma.auditLog.findMany({
        where: { bookingId: booking.id },
        include: {
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.platformNote.findMany({
        where: { entityType: 'BOOKING', entityId: String(booking.id) },
        include: { createdByUser: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const guest = redactPii({ phone: booking.guestPhone, email: booking.guestEmail }, admin)
    const clientPii = booking.client
      ? redactPii({ phone: booking.client.phone, email: booking.client.email }, admin)
      : null
    const customerPii = booking.customer
      ? redactPii({ phone: booking.customer.phone, email: booking.customer.email }, admin)
      : null

    return NextResponse.json({
      booking: {
        ...booking,
        guestPhone: guest.phone,
        guestEmail: guest.email,
        client: booking.client
          ? { ...booking.client, phone: clientPii?.phone ?? null, email: clientPii?.email ?? null }
          : null,
        customer: booking.customer
          ? { ...booking.customer, phone: customerPii?.phone ?? null, email: customerPii?.email ?? null }
          : null,
      },
      timeline: {
        bookingEvents: booking.bookingEvents,
        audit: audit.map((item) => ({
          id: item.id,
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          metadata: item.metadata,
          createdAt: item.createdAt,
          actor: item.actor,
        })),
      },
      notes: notes.map((note) => ({
        noteId: note.id,
        text: note.text,
        createdAt: note.createdAt,
        createdBy: note.createdByUser,
      })),
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

