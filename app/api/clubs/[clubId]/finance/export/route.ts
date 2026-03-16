import { NextRequest, NextResponse } from 'next/server'
import { exportFinanceCsv } from '@/src/lib/financeAnalytics'
import { getRangeFromRequest, jsonAuthError, parseTextQuery, requireFinancePermission } from '@/src/lib/financeApi'
import { prisma } from '@/src/lib/prisma'
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
      permission: PERMISSIONS.FINANCE_EXPORT,
    })
    const report = parseTextQuery(request.nextUrl.searchParams.get('report')) || 'overview'
    const range = getRangeFromRequest(request)
    const csv = await exportFinanceCsv({
      clubId,
      report,
      from: range.from,
      to: range.to,
    })

    await prisma.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'finance.exported',
        entityType: 'finance_export',
        entityId: report,
        metadata: JSON.stringify({
          from: range.from,
          to: range.to,
          report,
        }),
      },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="finance-${report}-${stamp}.csv"`,
      },
    })
  } catch (error) {
    const authError = jsonAuthError(error)
    return NextResponse.json(authError.payload, { status: authError.status })
  }
}
