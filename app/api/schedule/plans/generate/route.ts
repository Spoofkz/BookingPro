import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import { createSchedulePlanDraft } from '@/src/lib/schedulePlanService'

export const dynamic = 'force-dynamic'

type GenerateResponse = {
  planId: string
  status: string
  rangeStart: string
  rangeEnd: string
  generatedAt: Date
  rangeStartUtc: Date
  rangeEndUtc: Date
  diffSummary: unknown
  conflictSummary: unknown
  conflicts: unknown
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  const rawBody = await request.text()
  const requestHash = hashRequestBody(rawBody || '{}')
  let payload: unknown = {}
  if (rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody) as unknown
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Payload must be an object.' }, { status: 400 })
  }
  const record = payload as Record<string, unknown>
  const idempotencyKeyFromBody =
    typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : ''
  const idempotencyKey = readIdempotencyKey(request) ?? idempotencyKeyFromBody
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: 'idempotency-key header (or idempotencyKey body field) is required.' },
      { status: 400 },
    )
  }
  const clubId = typeof record.clubId === 'string' ? record.clubId.trim() : ''
  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }
  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  try {
    const replay = await replayIdempotentResponse<GenerateResponse>({
      userId: context.userId,
      operation: `schedule.plan.generate:${clubId}`,
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, {
        status: replay.statusCode,
        headers: { 'x-idempotent-replay': 'true' },
      })
    }

    const result = await createSchedulePlanDraft({
      clubId,
      userId: context.userId,
      templateId: typeof record.templateId === 'string' ? record.templateId.trim() : null,
      rangeStart: typeof record.rangeStart === 'string' ? record.rangeStart.trim() : null,
      rangeEnd: typeof record.rangeEnd === 'string' ? record.rangeEnd.trim() : null,
      horizonDays:
        typeof record.horizonDays === 'number' && Number.isInteger(record.horizonDays)
          ? record.horizonDays
          : null,
      options: record.options,
    })

    const response: GenerateResponse = {
      planId: result.plan.id,
      status: result.plan.status === 'DRAFT_GENERATED' ? 'DraftGenerated' : result.plan.status,
      rangeStart: result.plan.fromLocalDate,
      rangeEnd: result.plan.toLocalDate,
      generatedAt: result.plan.generatedAt,
      rangeStartUtc: result.plan.rangeStartUtc,
      rangeEndUtc: result.plan.rangeEndUtc,
      diffSummary: result.diffSummary,
      conflictSummary: result.conflictSummary,
      conflicts: result.conflicts,
    }

    await storeIdempotentResponse({
      userId: context.userId,
      operation: `schedule.plan.generate:${clubId}`,
      key: idempotencyKey,
      requestHash,
      statusCode: 201,
      body: response,
    })

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { code: 'IDEMPOTENCY_CONFLICT', error: error.message },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate schedule plan.' },
      { status: 400 },
    )
  }
}
