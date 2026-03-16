import { NextResponse } from 'next/server'
import { runFinanceForecast } from '@/src/lib/financeAnalytics'
import { jsonAuthError, parseBodyNumber, requireFinancePermission } from '@/src/lib/financeApi'
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
      permission: PERMISSIONS.FINANCE_FORECAST_CONFIG,
    })
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const forecast = await runFinanceForecast({
      clubId,
      actorUserId: context.userId,
      scenario: {
        horizonDays: parseBodyNumber(body, 'horizonDays', 7),
        priceChangePct: parseBodyNumber(body, 'priceChangePct', 0),
        promoDiscountPct: parseBodyNumber(body, 'promoDiscountPct', 0),
        extendedHoursPct: parseBodyNumber(body, 'extendedHoursPct', 0),
        extraBootcampSessionsPerDay: parseBodyNumber(body, 'extraBootcampSessionsPerDay', 0),
      },
      saveSnapshot: true,
    })
    return NextResponse.json(forecast)
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
