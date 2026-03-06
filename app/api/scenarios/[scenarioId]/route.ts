import { NextRequest, NextResponse } from 'next/server'
import { getScenarioById, updateScenario } from '@/src/lib/scenarioGovernance'
import {
  parseBooleanOrNull,
  parseNumberArray,
  parseScenarioStatus,
  parseStringArray,
  scenarioGovernanceErrorResponse,
} from '@/src/lib/scenarioGovernanceApi'
import { asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ scenarioId: string }> }

function parseOwnerMilestone(value: unknown) {
  const milestone = Number(value)
  if (!Number.isInteger(milestone) || milestone < 1 || milestone > 24) return null
  return milestone
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_READ)
    const { scenarioId } = await routeContext.params
    const data = await getScenarioById(scenarioId)
    if (!data) {
      return NextResponse.json({ error: 'Scenario not found.' }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_MANAGE)
    const { scenarioId } = await routeContext.params

    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const patch: Parameters<typeof updateScenario>[1] = {}
    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
      patch.name = asTrimmedString(payload.name) ?? ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'outcome')) {
      patch.outcome = asTrimmedString(payload.outcome) ?? ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'ownerMilestone')) {
      const ownerMilestone = parseOwnerMilestone(payload.ownerMilestone)
      if (ownerMilestone == null) {
        return NextResponse.json(
          { error: 'ownerMilestone must be between 1 and 24.' },
          { status: 400 },
        )
      }
      patch.ownerMilestone = ownerMilestone
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'dependencies')) {
      patch.dependencies = parseNumberArray(payload.dependencies)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'mvpScope')) {
      const mvpScope = parseBooleanOrNull(payload.mvpScope)
      if (mvpScope == null) {
        return NextResponse.json({ error: 'mvpScope must be true or false.' }, { status: 400 })
      }
      patch.mvpScope = mvpScope
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
      const status = parseScenarioStatus(payload.status)
      if (status == null) {
        return NextResponse.json({ error: 'status must be one of 0, 50, 100.' }, { status: 400 })
      }
      patch.status = status
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'nfrTags')) {
      patch.nfrTags = parseStringArray(payload.nfrTags)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
      patch.notes = asTrimmedString(payload.notes) ?? ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'gapNote')) {
      patch.gapNote = asTrimmedString(payload.gapNote) ?? ''
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'negativeCaseVerified')) {
      const negativeCaseVerified = parseBooleanOrNull(payload.negativeCaseVerified)
      if (negativeCaseVerified == null) {
        return NextResponse.json(
          { error: 'negativeCaseVerified must be true or false.' },
          { status: 400 },
        )
      }
      patch.negativeCaseVerified = negativeCaseVerified
    }

    const updated = await updateScenario(scenarioId, patch)

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.updated',
      entityType: 'scenario',
      entityId: updated.scenarioId,
      metadata: {
        fields: Object.keys(patch),
        status: updated.status,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
