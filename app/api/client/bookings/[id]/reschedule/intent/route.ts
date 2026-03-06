import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  ClientOwnershipError,
  parseBookingId,
  requireOwnedBooking,
} from '@/src/lib/clientOwnership'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { createRescheduleIntent, RescheduleFlowError } from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type Body = {
  newSlotId?: string
  newSeatId?: string
  packageId?: string | null
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

  const newSlotId = body.newSlotId?.trim() || ''
  if (!newSlotId) {
    return NextResponse.json({ error: 'newSlotId is required.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const owned = await requireOwnedBooking({
      bookingId,
      userId: context.userId,
      email: context.profile.email,
    })
    if (!owned.clubId) {
      return NextResponse.json({ error: 'Booking is not associated with a club.' }, { status: 409 })
    }

    const intent = await createRescheduleIntent({
      bookingId: owned.id,
      clubId: owned.clubId,
      mode: 'CLIENT',
      actorUserId: context.userId,
      newSlotId,
      newSeatId: body.newSeatId?.trim() || null,
      packageId:
        body.packageId === null
          ? null
          : body.packageId === undefined
            ? undefined
            : body.packageId.trim() || null,
    })

    return NextResponse.json(intent, { status: 201 })
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
