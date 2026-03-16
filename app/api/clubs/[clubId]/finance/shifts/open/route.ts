import { NextResponse } from 'next/server'
import { openFinanceShift } from '@/src/lib/financeAnalytics'
import {
  jsonAuthError,
  parseBodyNumber,
  parseBodyString,
  requireFinancePermission,
} from '@/src/lib/financeApi'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function POST(request: Request, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await requireFinancePermission({
      clubId,
      permission: PERMISSIONS.FINANCE_SHIFT_MANAGE,
    })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const shift = await openFinanceShift({
      clubId,
      actorUserId: context.userId,
      startingCashCents: parseBodyNumber(body, 'startingCashCents', 0),
      cashierName: parseBodyString(body, 'cashierName'),
      terminalLabel: parseBodyString(body, 'terminalLabel'),
      note: parseBodyString(body, 'note'),
    })
    return NextResponse.json({ shift })
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
