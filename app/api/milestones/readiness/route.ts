import { NextRequest, NextResponse } from 'next/server'
import {
  buildMatrices,
  getLatestReadinessByMilestone,
  listMilestones,
} from '@/src/lib/scenarioGovernance'
import { scenarioGovernanceErrorResponse } from '@/src/lib/scenarioGovernanceApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_READ)
    const includeMatrices = request.nextUrl.searchParams.get('includeMatrices') === 'true'
    const [items, milestones, matrices] = await Promise.all([
      getLatestReadinessByMilestone(),
      listMilestones(),
      includeMatrices ? buildMatrices() : Promise.resolve(null),
    ])

    return NextResponse.json({
      items,
      milestones,
      total: items.length,
      ...(matrices ? { matrixA: matrices.matrixA, matrixB: matrices.matrixB } : {}),
    })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
