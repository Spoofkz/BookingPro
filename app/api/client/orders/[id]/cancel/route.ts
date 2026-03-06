import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { cancelOwnedOrder, CommerceError } from '@/src/lib/commerceService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function POST(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const orderId = id.trim()
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const order = await cancelOwnedOrder({
      orderId,
      userId: context.userId,
    })
    return NextResponse.json(order)
  } catch (error) {
    if (error instanceof CommerceError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to cancel order.' }, { status: 500 })
  }
}
