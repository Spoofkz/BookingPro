import { NextRequest, NextResponse } from 'next/server'
import { addScenarioLink } from '@/src/lib/scenarioGovernance'
import {
  parseScenarioLinkType,
  scenarioGovernanceErrorResponse,
} from '@/src/lib/scenarioGovernanceApi'
import { asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ scenarioId: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_MANAGE)
    const { scenarioId } = await routeContext.params

    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const linkType = parseScenarioLinkType(payload.linkType)
    if (!linkType) {
      return NextResponse.json(
        { error: 'linkType must be one of PRD, AC, TEST, EVIDENCE, BACKLOG.' },
        { status: 400 },
      )
    }

    const title = asTrimmedString(payload.title)
    const url = asTrimmedString(payload.url)
    if (!title || !url) {
      return NextResponse.json({ error: 'title and url are required.' }, { status: 400 })
    }

    const link = await addScenarioLink(scenarioId, { linkType, title, url })
    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.link_added',
      entityType: 'scenario',
      entityId: scenarioId,
      metadata: {
        linkId: link.linkId,
        linkType: link.linkType,
      },
    })

    return NextResponse.json(link, { status: 201 })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
