import { DisputeType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type CreateSupportBody = {
  bookingId?: number
  type?: string
  subject?: string
  description?: string
}

function parseDisputeType(input: string | undefined) {
  if (input === DisputeType.BOOKING_ISSUE) return DisputeType.BOOKING_ISSUE
  if (input === DisputeType.PAYMENT_ISSUE) return DisputeType.PAYMENT_ISSUE
  if (input === DisputeType.FRAUD_SUSPECTED) return DisputeType.FRAUD_SUSPECTED
  if (input === DisputeType.MISCONDUCT) return DisputeType.MISCONDUCT
  return DisputeType.BOOKING_ISSUE
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const items = await prisma.dispute.findMany({
      where: { customerUserId: context.userId },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            checkIn: true,
            checkOut: true,
            roomId: true,
          },
        },
        club: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })

    return NextResponse.json({
      items: items.map((item) => ({
        disputeId: item.id,
        type: item.type,
        status: item.status,
        subject: item.subject,
        description: item.description,
        resolutionSummary: item.resolutionSummary,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        booking: item.booking,
        club: item.club,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  let body: CreateSupportBody
  try {
    body = (await request.json()) as CreateSupportBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const subject = body.subject?.trim() || ''
  const description = body.description?.trim() || ''
  if (!subject) {
    return NextResponse.json({ error: 'subject is required.' }, { status: 400 })
  }
  if (!description) {
    return NextResponse.json({ error: 'description is required.' }, { status: 400 })
  }
  if (description.length > 4000) {
    return NextResponse.json({ error: 'description is too long.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const bookingId =
      Number.isInteger(body.bookingId) && Number(body.bookingId) > 0
        ? Number(body.bookingId)
        : null

    let booking: {
      id: number
      clubId: string | null
      clientUserId: string | null
      guestEmail: string
    } | null = null
    if (bookingId) {
      booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          clubId: true,
          clientUserId: true,
          guestEmail: true,
        },
      })
      const normalizedEmail = context.profile.email?.toLowerCase() || null
      const ownsBooking =
        booking &&
        (booking.clientUserId === context.userId ||
          (normalizedEmail && booking.guestEmail.toLowerCase() === normalizedEmail))
      if (!ownsBooking) {
        return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
      }
    }

    const dispute = await prisma.dispute.create({
      data: {
        clubId: booking?.clubId || context.activeClubId || null,
        bookingId: booking?.id || null,
        customerUserId: context.userId,
        createdByUserId: context.userId,
        type: parseDisputeType(body.type),
        subject,
        description,
      },
      select: {
        id: true,
        status: true,
        type: true,
        bookingId: true,
        clubId: true,
        subject: true,
        description: true,
        createdAt: true,
      },
    })

    await prisma.auditLog.create({
      data: {
        clubId: dispute.clubId,
        actorUserId: context.userId,
        action: 'support.request.created',
        entityType: 'dispute',
        entityId: dispute.id,
        bookingId: dispute.bookingId || null,
        metadata: JSON.stringify({
          type: dispute.type,
        }),
      },
    })

    return NextResponse.json(
      {
        disputeId: dispute.id,
        status: dispute.status,
        type: dispute.type,
        bookingId: dispute.bookingId,
        clubId: dispute.clubId,
        subject: dispute.subject,
        description: dispute.description,
        createdAt: dispute.createdAt,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
