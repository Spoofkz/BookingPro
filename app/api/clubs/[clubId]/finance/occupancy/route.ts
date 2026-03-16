import { NextRequest, NextResponse } from 'next/server'
import { getFinanceOccupancyBreakdown } from '@/src/lib/financeAnalytics'
import {
  getRangeFromRequest,
  jsonAuthError,
  parseTextQuery,
  requireFinancePermission,
} from '@/src/lib/financeApi'
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
      permission: PERMISSIONS.FINANCE_ANALYTICS_READ,
    })
    const range = getRangeFromRequest(request)
    const payload = await getFinanceOccupancyBreakdown({
      clubId,
      from: range.from,
      to: range.to,
      groupBy: parseTextQuery(request.nextUrl.searchParams.get('groupBy')),
    })
    return NextResponse.json(payload)
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
