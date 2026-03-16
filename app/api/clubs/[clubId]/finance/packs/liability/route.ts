import { NextResponse } from 'next/server'
import { getFinanceLiability } from '@/src/lib/financeAnalytics'
import { jsonAuthError, requireFinancePermission } from '@/src/lib/financeApi'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    await requireFinancePermission({
      clubId,
      permission: PERMISSIONS.FINANCE_ANALYTICS_READ,
    })
    const payload = await getFinanceLiability({ clubId })
    return NextResponse.json(payload)
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
