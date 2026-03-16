import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { getClubFinanceRecords } from '@/src/lib/financeRecords'
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
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') || '50')))

    const payload = await getClubFinanceRecords({
      clubId,
      filters: {
        page,
        pageSize,
        source: parseSource(searchParams.get('source')),
        status: searchParams.get('status'),
        query: searchParams.get('q'),
        dateFrom: parseDateParam(searchParams.get('dateFrom')),
        dateTo: parseDateParam(searchParams.get('dateTo')),
      },
    })

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

