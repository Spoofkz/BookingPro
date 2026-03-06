import { NextResponse } from 'next/server'
import { recomputeMilestoneReadiness } from '@/src/lib/scenarioGovernance'
import { scenarioGovernanceErrorResponse } from '@/src/lib/scenarioGovernanceApi'
import { createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_MANAGE)
    const snapshots = await recomputeMilestoneReadiness()
    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.readiness_recomputed',
      entityType: 'scenario',
      entityId: 'milestones',
      metadata: {
        snapshots: snapshots.length,
      },
    })
    return NextResponse.json({ items: snapshots, total: snapshots.length })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
