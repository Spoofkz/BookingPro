import { MembershipPlanStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { MembershipFlowError, setMembershipPlanStatus } from '@/src/lib/membershipService'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; planId: string }>
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
  }
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

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId, planId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_PLAN_MANAGE)

    const plan = await setMembershipPlanStatus({
      clubId,
      actorUserId: context.userId,
      planId,
      status: MembershipPlanStatus.ACTIVE,
    })

    return NextResponse.json(plan)
  } catch (error) {
    return errorResponse(error)
  }
}
