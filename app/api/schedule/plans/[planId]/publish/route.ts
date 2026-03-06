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
import { publishSchedulePlan } from '@/src/lib/schedulePlanService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ planId: string }>
}

type PublishResponse = {
  schedulePublishedAt: Date
  slotsGeneratedUntil: Date
  publishMode: 'SAFE' | 'FORCE'
  result: {
    created: number
    updated: number
    blocked: number
    locked: number
    removed: number
  }
  diffSummary: unknown
  conflictSummary: unknown
  conflicts: unknown
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { planId } = await routeContext.params
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
  const effectiveFromRaw = typeof record.effectiveFrom === 'string' ? record.effectiveFrom.trim() : ''
  const effectiveFrom =
    effectiveFromRaw.length > 0 ? new Date(effectiveFromRaw) : null
  if (effectiveFrom && Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: 'effectiveFrom must be a valid ISO datetime.' }, { status: 400 })
  }
  const touchWindowMinutes =
    typeof record.touchWindowMinutes === 'number' && Number.isInteger(record.touchWindowMinutes)
      ? record.touchWindowMinutes
      : 240
  const publishMode = record.publishMode === 'FORCE' ? 'FORCE' : 'SAFE'
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (publishMode === 'FORCE' && !reason) {
    return NextResponse.json(
      { error: 'reason is required for FORCE publish mode.' },
      { status: 400 },
    )
  }

  try {
    const replay = await replayIdempotentResponse<PublishResponse>({
      userId: context.userId,
      operation: `schedule.plan.publish:${planId}`,
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, {
        status: replay.statusCode,
        headers: { 'x-idempotent-replay': 'true' },
      })
    }

    const published = await publishSchedulePlan({
      planId,
      clubId,
      userId: context.userId,
      effectiveFrom,
      touchWindowMinutes,
      publishMode,
      reason: reason || null,
    })
    const response: PublishResponse = {
      schedulePublishedAt: published.schedulePublishedAt,
      slotsGeneratedUntil: published.slotsGeneratedUntil,
      publishMode,
      result: published.result,
      diffSummary: published.diffSummary,
      conflictSummary: published.conflictSummary,
      conflicts: published.conflicts,
    }

    await storeIdempotentResponse({
      userId: context.userId,
      operation: `schedule.plan.publish:${planId}`,
      key: idempotencyKey,
      requestHash,
      statusCode: 200,
      body: response,
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { code: 'IDEMPOTENCY_CONFLICT', error: error.message },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish schedule plan.' },
      { status: 400 },
    )
  }
}
