import { NextRequest, NextResponse } from 'next/server'
import { deleteScenarioLink } from '@/src/lib/scenarioGovernance'
import { scenarioGovernanceErrorResponse } from '@/src/lib/scenarioGovernanceApi'
import { createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ scenarioId: string; linkId: string }> }

export async function DELETE(_: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_MANAGE)
    const { scenarioId, linkId } = await routeContext.params

    await deleteScenarioLink(scenarioId, linkId)
    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.link_removed',
      entityType: 'scenario',
      entityId: scenarioId,
      metadata: { linkId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
