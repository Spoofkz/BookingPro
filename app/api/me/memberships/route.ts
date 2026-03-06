import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { listUserMembershipSnapshot, MembershipFlowError } from '@/src/lib/membershipService'

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

    return NextResponse.json({
      clubId,
      ...snapshot,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
