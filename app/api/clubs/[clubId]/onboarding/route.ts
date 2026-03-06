import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { loadClubOnboardingReport } from '@/src/lib/onboardingChecklist'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  try {
    const report = await loadClubOnboardingReport(clubId)
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to evaluate onboarding checklist.'
    if (message === 'Club not found.') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
