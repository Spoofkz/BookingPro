import { NextRequest, NextResponse } from 'next/server'
import { getLatestForecastSnapshots, runFinanceForecast } from '@/src/lib/financeAnalytics'
import { jsonAuthError, parseTextQuery, requireFinancePermission } from '@/src/lib/financeApi'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await requireFinancePermission({
      clubId,
      permission: PERMISSIONS.FINANCE_ANALYTICS_READ,
    })

    const mode = parseTextQuery(request.nextUrl.searchParams.get('mode')) || 'latest'
    if (mode === 'run') {
      const forecast = await runFinanceForecast({
        clubId,
        actorUserId: context.userId,
        saveSnapshot: false,
      })
      return NextResponse.json({ items: [forecast] })
    }

    const items = await getLatestForecastSnapshots({ clubId, limit: 5 })
    return NextResponse.json({ items })
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
