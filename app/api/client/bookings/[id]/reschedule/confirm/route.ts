import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  ClientOwnershipError,
  parseBookingId,
  requireOwnedBooking,
} from '@/src/lib/clientOwnership'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { prisma } from '@/src/lib/prisma'
import { confirmRescheduleIntent, type ReschedulePayMode, RescheduleFlowError } from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type Body = {
  rescheduleId?: string
  payMode?: 'ONLINE' | 'OFFLINE' | 'NONE'
}

function parsePayMode(value: unknown): ReschedulePayMode {
  if (value === 'ONLINE') return 'ONLINE'
  if (value === 'OFFLINE') return 'OFFLINE'
  return 'NONE'
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('reschedule')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

  const { id } = await routeContext.params
  const bookingId = parseBookingId(id)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const rescheduleId = body.rescheduleId?.trim() || ''
  if (!rescheduleId) {
    return NextResponse.json({ error: 'rescheduleId is required.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const owned = await requireOwnedBooking({
      bookingId,
      userId: context.userId,
      email: context.profile.email,
    })

    const intent = await prisma.rescheduleIntent.findUnique({
      where: { id: rescheduleId },
      select: {
        id: true,
        bookingId: true,
        clubId: true,
      },
    })
    if (!intent || intent.bookingId !== owned.id || intent.clubId !== owned.clubId) {
      return NextResponse.json({ error: 'Reschedule intent not found.' }, { status: 404 })
    }

    const confirmed = await confirmRescheduleIntent({
      rescheduleId: intent.id,
      clubId: intent.clubId,
      mode: 'CLIENT',
      actorUserId: context.userId,
      payMode: parsePayMode(body.payMode),
    })

    return NextResponse.json({
      bookingId: confirmed.bookingId,
      status: confirmed.status,
      slotId: confirmed.slotId,
      seatId: confirmed.seatId,
      checkIn: confirmed.checkIn,
      checkOut: confirmed.checkOut,
      delta: confirmed.delta,
      settlementStatus: confirmed.settlementStatus,
    })
  } catch (error) {
    if (error instanceof ClientOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof RescheduleFlowError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.details ?? {}),
        },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
