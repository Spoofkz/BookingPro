import { NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { getClubFinanceRecordDetail } from '@/src/lib/financeRecords'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; recordId: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { clubId, recordId } = await routeContext.params

  try {
    const context = await getCabinetContext({ requireSession: true })
    requirePermissionInClub(context, clubId, PERMISSIONS.CLUB_READ)

    const detail = await getClubFinanceRecordDetail({
      clubId,
      recordId,
    })
    if (!detail) {
      return NextResponse.json({ error: 'Finance document not found.' }, { status: 404 })
    }

    await prisma.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'finance.invoice.viewed',
        entityType: 'finance_document',
        entityId: detail.recordId,
        ...(detail.booking ? { bookingId: detail.booking.id } : {}),
        metadata: JSON.stringify({
          sourceType: detail.sourceType,
          invoiceNumber: detail.invoiceNumber,
        }),
      },
    })

    return NextResponse.json(detail)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

