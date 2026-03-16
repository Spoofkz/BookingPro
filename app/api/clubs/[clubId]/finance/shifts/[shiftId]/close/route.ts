import { NextResponse } from 'next/server'
import { closeFinanceShift } from '@/src/lib/financeAnalytics'
import {
  jsonAuthError,
  parseBodyNumber,
  parseBodyString,
  requireFinancePermission,
} from '@/src/lib/financeApi'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; shiftId: string }>
}

export async function POST(request: Request, routeContext: RouteContext) {
  const { clubId, shiftId } = await routeContext.params

  try {
    const context = await requireFinancePermission({
      clubId,
      permission: PERMISSIONS.FINANCE_SHIFT_MANAGE,
    })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const shift = await closeFinanceShift({
      clubId,
      shiftId,
      actorUserId: context.userId,
      actualCashCents: parseBodyNumber(body, 'actualCashCents', 0),
      closeNote: parseBodyString(body, 'closeNote'),
      actorCanApproveDiscrepancy: context.memberships.some(
        (membership) =>
          membership.status === 'ACTIVE' &&
          membership.clubId === clubId &&
          membership.role === 'TECH_ADMIN',
      ),
    })
    return NextResponse.json({ shift })
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
