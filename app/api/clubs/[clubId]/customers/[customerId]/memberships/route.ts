import { NextRequest, NextResponse } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  listCustomerMembershipSnapshot,
  MembershipFlowError,
} from '@/src/lib/membershipService'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; customerId: string }>
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
  const { clubId, customerId } = await routeContext.params

  try {
    const context = await getCabinetContext()
    requirePermissionInClub(context, clubId, PERMISSIONS.MEMBERSHIP_READ)

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        clubId,
        status: { not: 'DELETED' },
      },
      select: { id: true },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
    }

    const snapshot = await listCustomerMembershipSnapshot({ clubId, customerId })

    return NextResponse.json({
      clubId,
      customerId,
      ...snapshot,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
