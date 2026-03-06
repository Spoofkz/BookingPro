import { NextRequest, NextResponse } from 'next/server'
import {
  buildMatrices,
  createScenario,
  listMilestones,
  listScenariosFiltered,
} from '@/src/lib/scenarioGovernance'
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

function parseOwnerMilestone(value: unknown) {
  const milestone = Number(value)
  if (!Number.isInteger(milestone) || milestone < 1 || milestone > 24) return null
  return milestone
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_READ)
    const searchParams = request.nextUrl.searchParams
    const milestoneId = searchParams.get('milestoneId')
      ? parseOwnerMilestone(searchParams.get('milestoneId'))
      : null
    if (searchParams.get('milestoneId') && milestoneId == null) {
      return NextResponse.json({ error: 'milestoneId is invalid.' }, { status: 400 })
    }

    const statusParam = searchParams.get('status')
    const status = statusParam == null ? null : parseScenarioStatus(statusParam)
    if (statusParam != null && status == null) {
      return NextResponse.json({ error: 'status must be one of 0, 50, 100.' }, { status: 400 })
    }

    const mvpScopeParam = searchParams.get('mvpScope')
    const mvpScope = mvpScopeParam == null ? null : parseBooleanOrNull(mvpScopeParam)
    if (mvpScopeParam != null && mvpScope == null) {
      return NextResponse.json({ error: 'mvpScope must be true or false.' }, { status: 400 })
    }

    const includeMatrices = searchParams.get('includeMatrices') === 'true'
    const q = searchParams.get('q')
    const tag = searchParams.get('tag')

    const [items, milestones, matrices] = await Promise.all([
      listScenariosFiltered({
        milestoneId,
        status,
        mvpScope,
        q,
        tag,
      }),
      listMilestones(),
      includeMatrices ? buildMatrices() : Promise.resolve(null),
    ])

    return NextResponse.json({
      items,
      total: items.length,
      milestones,
      ...(matrices ? { matrixA: matrices.matrixA, matrixB: matrices.matrixB } : {}),
    })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.SCENARIOS_MANAGE)
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const ownerMilestone = parseOwnerMilestone(payload.ownerMilestone)
    if (ownerMilestone == null) {
      return NextResponse.json({ error: 'ownerMilestone must be between 1 and 24.' }, { status: 400 })
    }

    let status: 0 | 50 | 100 | undefined
    if (payload.status != null) {
      const parsedStatus = parseScenarioStatus(payload.status)
      if (parsedStatus == null) {
        return NextResponse.json({ error: 'status must be one of 0, 50, 100.' }, { status: 400 })
      }
      status = parsedStatus
    }

    const created = await createScenario({
      scenarioId: asTrimmedString(payload.scenarioId) ?? '',
      name: asTrimmedString(payload.name) ?? '',
      outcome: asTrimmedString(payload.outcome) ?? '',
      ownerMilestone,
      dependencies: parseNumberArray(payload.dependencies),
      mvpScope: parseBooleanOrNull(payload.mvpScope) ?? true,
      status,
      nfrTags: parseStringArray(payload.nfrTags),
      notes: asTrimmedString(payload.notes) ?? '',
      gapNote: asTrimmedString(payload.gapNote) ?? '',
      createdBy: admin.userId,
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.created',
      entityType: 'scenario',
      entityId: created.scenarioId,
      metadata: {
        ownerMilestone: created.ownerMilestone,
        mvpScope: created.mvpScope,
        dependencies: created.dependencies,
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
