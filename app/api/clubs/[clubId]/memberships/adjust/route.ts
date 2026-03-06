import { MembershipActorRole } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { adjustMembershipEntitlement, MembershipFlowError } from '@/src/lib/membershipService'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type AdjustBody = {
  entitlementId?: string
  minutesDelta?: number
  sessionsDelta?: number
  amountDelta?: number
  reason?: string
}

function parseIntOrZero(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return 0
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

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_ADJUST)

    let body: AdjustBody
    try {
      body = (await request.json()) as AdjustBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const entitlementId = body.entitlementId?.trim() || ''
    if (!entitlementId) {
      return NextResponse.json({ error: 'entitlementId is required.' }, { status: 400 })
    }

    const adjusted = await adjustMembershipEntitlement({
      clubId,
      entitlementId,
      actorUserId: context.userId,
      actorRole: MembershipActorRole.STAFF,
      minutesDelta: parseIntOrZero(body.minutesDelta),
      sessionsDelta: parseIntOrZero(body.sessionsDelta),
      amountDelta: parseIntOrZero(body.amountDelta),
      reason: body.reason || '',
    })

    return NextResponse.json(adjusted)
  } catch (error) {
    return errorResponse(error)
  }
}
