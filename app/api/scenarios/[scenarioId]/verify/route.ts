import { NextRequest, NextResponse } from 'next/server'
import { addVerificationRun } from '@/src/lib/scenarioGovernance'
import {
  parseBooleanOrNull,
  parseCoverageVerdict,
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

    const verdict = parseCoverageVerdict(payload.verdict)
    if (!verdict) {
      return NextResponse.json(
        { error: 'verdict must be one of Missing, Partial, Covered.' },
        { status: 400 },
      )
    }

    const run = await addVerificationRun(scenarioId, {
      environment: asTrimmedString(payload.environment) ?? 'staging',
      verdict,
      notes: asTrimmedString(payload.notes) ?? '',
      artifactUrl: asTrimmedString(payload.artifactUrl) ?? '',
      negativeCaseRecorded: parseBooleanOrNull(payload.negativeCaseRecorded) ?? false,
      createdBy: admin.userId,
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      action: 'scenario.verification_recorded',
      entityType: 'scenario',
      entityId: scenarioId,
      metadata: {
        runId: run.runId,
        verdict: run.verdict,
        environment: run.environment,
        negativeCaseRecorded: run.negativeCaseRecorded,
      },
    })

    return NextResponse.json(run, { status: 201 })
  } catch (error) {
    return scenarioGovernanceErrorResponse(error)
  }
}
