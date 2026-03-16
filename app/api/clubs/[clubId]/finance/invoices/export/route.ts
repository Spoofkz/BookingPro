import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { financeRecordsToCsv, getClubFinanceRecords } from '@/src/lib/financeRecords'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseDateParam(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function parseSource(value: string | null) {
  const raw = (value || '').trim().toUpperCase()
  if (raw === 'INVOICE') return 'INVOICE' as const
  if (raw === 'RECEIPT') return 'RECEIPT' as const
  return 'ALL' as const
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params

  try {
    const context = await getCabinetContext({ requireSession: true })
    requirePermissionInClub(context, clubId, PERMISSIONS.CLUB_READ)

    const searchParams = request.nextUrl.searchParams
    const payload = await getClubFinanceRecords({
      clubId,
      filters: {
        page: 1,
        pageSize: 5000,
        source: parseSource(searchParams.get('source')),
        status: searchParams.get('status'),
        query: searchParams.get('q'),
        dateFrom: parseDateParam(searchParams.get('dateFrom')),
        dateTo: parseDateParam(searchParams.get('dateTo')),
      },
    })

    const csv = financeRecordsToCsv(payload.items)
    const stamp = new Date().toISOString().slice(0, 10)

    await prisma.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'finance.invoice.exported',
        entityType: 'finance_document',
        entityId: clubId,
        metadata: JSON.stringify({
          count: payload.items.length,
          stamp,
        }),
      },
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="finance-invoices-${stamp}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

