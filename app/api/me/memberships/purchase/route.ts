import { MembershipActorRole } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { MembershipFlowError, purchaseMembershipPlan } from '@/src/lib/membershipService'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type PurchaseBody = {
  clubId?: string
  planId?: string
  paymentMode?: 'ONLINE' | 'OFFLINE'
}

function errorResponse(error: unknown) {
  if (error instanceof MembershipFlowError) {
    return NextResponse.json(
      {
        code: error.code,
        error: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status },
    )
  }
  throw error
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })

    let body: PurchaseBody
    try {
      body = (await request.json()) as PurchaseBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const clubId = body.clubId?.trim() || context.activeClubId
    const planId = body.planId?.trim() || ''
    const paymentMode = body.paymentMode === 'ONLINE' ? 'ONLINE' : 'OFFLINE'

    if (!clubId) {
      return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
    }
    if (!planId) {
      return NextResponse.json({ error: 'planId is required.' }, { status: 400 })
    }

    const membership = context.memberships.find(
      (item) => item.clubId === clubId && item.status === 'ACTIVE',
    )
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const customer = await prisma.customer.findFirst({
      where: {
        clubId,
        linkedUserId: context.userId,
        status: { not: 'DELETED' },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    })

    const purchase = await purchaseMembershipPlan({
      clubId,
      planId,
      paymentMode,
      actorUserId: context.userId,
      actorRole: MembershipActorRole.CLIENT,
      userId: context.userId,
      customerId: customer?.id || null,
    })

    return NextResponse.json(purchase, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
