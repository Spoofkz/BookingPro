import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { getSchedulePlanSnapshot } from '@/src/lib/schedulePlanService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ planId: string }>
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { planId } = await routeContext.params
  const clubId = request.nextUrl.searchParams.get('clubId')?.trim() || ''
  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }

  const context = await getCabinetContext()
  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const plan = await getSchedulePlanSnapshot(planId, clubId)
  if (!plan) {
    return NextResponse.json({ error: 'Schedule plan was not found.' }, { status: 404 })
  }

  return NextResponse.json({
    planId: plan.id,
    status: plan.status,
    summary: plan.conflictSummary,
    conflicts: plan.conflicts,
    total: plan.conflicts.length,
  })
}
