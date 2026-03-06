import { MembershipPlanType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { listUserMembershipSnapshot } from '@/src/lib/membershipService'

export const dynamic = 'force-dynamic'

function resolveClubId(request: NextRequest, activeClubId: string | null) {
  return request.nextUrl.searchParams.get('clubId')?.trim() || activeClubId
}

function userHasClubMembership(
  memberships: Array<{ clubId: string; status: 'INVITED' | 'ACTIVE' | 'DISABLED' }>,
  clubId: string,
) {
  return memberships.some((item) => item.clubId === clubId && item.status === 'ACTIVE')
}

export async function GET(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const clubId = resolveClubId(request, context.activeClubId)
    if (!clubId) {
      return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
    }
    if (!userHasClubMembership(context.memberships, clubId)) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const snapshot = await listUserMembershipSnapshot({
      clubId,
      userId: context.userId,
    })
    const walletEntitlements = snapshot.entitlements.filter(
      (item) => item.type === MembershipPlanType.WALLET_TOPUP,
    )
    const balance = walletEntitlements.reduce(
      (sum, item) => sum + Math.max(0, item.walletBalance ?? 0),
      0,
    )

    return NextResponse.json({
      clubId,
      balance,
      entitlements: walletEntitlements,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
