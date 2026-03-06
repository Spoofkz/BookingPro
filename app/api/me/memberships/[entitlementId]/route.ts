import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ entitlementId: string }>
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { entitlementId } = await routeContext.params
  const normalizedEntitlementId = entitlementId.trim()
  if (!normalizedEntitlementId) {
    return NextResponse.json({ error: 'Invalid entitlement id.' }, { status: 400 })
  }

  const context = await getCabinetContext({ requireSession: true })
  const clubId = request.nextUrl.searchParams.get('clubId')?.trim() || context.activeClubId

  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }

  const entitlement = await prisma.membershipEntitlement.findFirst({
    where: {
      id: normalizedEntitlementId,
      clubId,
      userId: context.userId,
    },
    include: {
      plan: true,
      transactions: {
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      },
    },
  })

  if (!entitlement) {
    return NextResponse.json({ error: 'Entitlement not found.' }, { status: 404 })
  }

  return NextResponse.json({
    entitlementId: entitlement.id,
    clubId: entitlement.clubId,
    type: entitlement.type,
    status: entitlement.status,
    planId: entitlement.planId,
    remainingMinutes: entitlement.remainingMinutes,
    remainingSessions: entitlement.remainingSessions,
    walletBalance: entitlement.walletBalance,
    validFrom: entitlement.validFrom,
    validTo: entitlement.validTo,
    autoRenew: entitlement.autoRenew,
    periodStart: entitlement.periodStart,
    periodEnd: entitlement.periodEnd,
    plan: entitlement.plan,
    transactions: entitlement.transactions.map((item) => ({
      txId: item.id,
      txType: item.txType,
      amountDelta: item.amountDelta,
      minutesDelta: item.minutesDelta,
      sessionsDelta: item.sessionsDelta,
      bookingId: item.bookingId,
      reason: item.reason,
      createdAt: item.createdAt,
    })),
  })
}
