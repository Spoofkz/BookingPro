import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { getOwnedOrder } from '@/src/lib/commerceService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const orderId = id.trim()
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const order = await getOwnedOrder({ orderId, userId: context.userId })
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }
    return NextResponse.json(order)
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
