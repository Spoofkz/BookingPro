import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { ClientOwnershipError, parseBookingId, requireOwnedBooking } from '@/src/lib/clientOwnership'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const bookingId = parseBookingId(id)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    await requireOwnedBooking({
      bookingId,
      userId: context.userId,
      email: context.profile.email,
    })

    return NextResponse.json(
      {
        code: 'EXTEND_NOT_AVAILABLE',
        error: 'Booking extension is not available yet.',
      },
      { status: 501 },
    )
  } catch (error) {
    if (error instanceof ClientOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
