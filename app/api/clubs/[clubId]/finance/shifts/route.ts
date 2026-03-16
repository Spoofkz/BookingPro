import { NextRequest, NextResponse } from 'next/server'
import { getFinanceShifts } from '@/src/lib/financeAnalytics'
import { getRangeFromRequest, jsonAuthError, requireFinancePermission } from '@/src/lib/financeApi'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    await requireFinancePermission({
      clubId,
      permission: PERMISSIONS.FINANCE_SHIFT_MANAGE,
    })
    const range = getRangeFromRequest(request)
    const payload = await getFinanceShifts({
      clubId,
      from: range.from,
      to: range.to,
    })
    return NextResponse.json(payload)
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
