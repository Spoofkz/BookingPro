import { MembershipPlanType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  createMembershipPlan,
  listMembershipPlans,
  MembershipFlowError,
} from '@/src/lib/membershipService'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type CreatePlanBody = {
  type?: string
  name?: string
  description?: string | null
  priceAmount?: number
  currency?: string
  valueAmount?: number
  billingPeriod?: 'WEEKLY' | 'MONTHLY' | null
  eligibilityJson?: string | null
  timeRestrictionsJson?: string | null
  expiryPolicyJson?: string | null
  isClientVisible?: boolean
  isHostVisible?: boolean
  allowStacking?: boolean
}

function parsePlanType(value: unknown) {
  if (value === MembershipPlanType.TIME_PACK) return MembershipPlanType.TIME_PACK
  if (value === MembershipPlanType.SESSION_PACK) return MembershipPlanType.SESSION_PACK
  if (value === MembershipPlanType.WALLET_TOPUP) return MembershipPlanType.WALLET_TOPUP
  if (value === MembershipPlanType.SUBSCRIPTION) return MembershipPlanType.SUBSCRIPTION
  return null
}

function parseBooleanQuery(value: string | null) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
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

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_READ)

    const includeInactive = parseBooleanQuery(request.nextUrl.searchParams.get('includeInactive'))
    const onlyClientVisible = parseBooleanQuery(
      request.nextUrl.searchParams.get('onlyClientVisible'),
    )

    const plans = await listMembershipPlans({
      clubId,
      includeInactive,
      onlyClientVisible,
    })

    return NextResponse.json({
      items: plans,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_PLAN_MANAGE)

    let body: CreatePlanBody
    try {
      body = (await request.json()) as CreatePlanBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const type = parsePlanType(body.type)
    if (!type) {
      return NextResponse.json({ error: 'type is invalid.' }, { status: 400 })
    }

    const created = await createMembershipPlan({
      clubId,
      actorUserId: context.userId,
      type,
      name: body.name || '',
      description: body.description,
      priceAmount: Number(body.priceAmount),
      currency: body.currency || 'KZT',
      valueAmount: Number(body.valueAmount),
      billingPeriod: body.billingPeriod,
      eligibilityJson: body.eligibilityJson,
      timeRestrictionsJson: body.timeRestrictionsJson,
      expiryPolicyJson: body.expiryPolicyJson,
      isClientVisible: body.isClientVisible,
      isHostVisible: body.isHostVisible,
      allowStacking: body.allowStacking,
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
