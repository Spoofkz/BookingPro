import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CommerceError, markOfflineOrderPaidByStaff } from '@/src/lib/commerceService'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type Payload = {
  reason?: string
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const orderId = id.trim()
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id.' }, { status: 400 })
  }

  let payload: Payload = {}
  try {
    payload = (await request.json()) as Payload
  } catch {
    payload = {}
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, clubId: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    try {
      requirePermissionInClub(context, order.clubId, PERMISSIONS.PAYMENT_MARK_PAID)
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const result = await markOfflineOrderPaidByStaff({
      orderId: order.id,
      actorUserId: context.userId,
      reason: payload.reason || null,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CommerceError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to mark order as paid.' }, { status: 500 })
  }
}
