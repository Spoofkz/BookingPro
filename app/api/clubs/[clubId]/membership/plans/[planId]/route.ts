import { MembershipPlanType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  MembershipFlowError,
  updateMembershipPlan,
} from '@/src/lib/membershipService'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; planId: string }>
}

type UpdatePlanBody = {
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
  if (value === undefined) return undefined
  if (value === MembershipPlanType.TIME_PACK) return MembershipPlanType.TIME_PACK
  if (value === MembershipPlanType.SESSION_PACK) return MembershipPlanType.SESSION_PACK
  if (value === MembershipPlanType.WALLET_TOPUP) return MembershipPlanType.WALLET_TOPUP
  if (value === MembershipPlanType.SUBSCRIPTION) return MembershipPlanType.SUBSCRIPTION
  return null
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

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId, planId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_READ)

    const plan = await prisma.membershipPlan.findFirst({
      where: {
        id: planId,
        clubId,
      },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Plan was not found.' }, { status: 404 })
    }

    return NextResponse.json(plan)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { clubId, planId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_PLAN_MANAGE)

    let body: UpdatePlanBody
    try {
      body = (await request.json()) as UpdatePlanBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const type = parsePlanType(body.type)
    if (type === null) {
      return NextResponse.json({ error: 'type is invalid.' }, { status: 400 })
    }

    const updated = await updateMembershipPlan({
      clubId,
      actorUserId: context.userId,
      planId,
      type,
      name: body.name,
      description: body.description,
      priceAmount:
        body.priceAmount === undefined ? undefined : Math.trunc(Number(body.priceAmount)),
      currency: body.currency,
      valueAmount:
        body.valueAmount === undefined ? undefined : Math.trunc(Number(body.valueAmount)),
      billingPeriod: body.billingPeriod,
      eligibilityJson: body.eligibilityJson,
      timeRestrictionsJson: body.timeRestrictionsJson,
      expiryPolicyJson: body.expiryPolicyJson,
      isClientVisible: body.isClientVisible,
      isHostVisible: body.isHostVisible,
      allowStacking: body.allowStacking,
    })

    return NextResponse.json(updated)
  } catch (error) {
    return errorResponse(error)
  }
}
