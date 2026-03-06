import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import { assertFeatureEnabled, featureErrorResponse } from '@/src/lib/featureFlags'
import { resolveIntentRescheduleAccess } from '@/src/lib/rescheduleAccess'
import {
  confirmRescheduleIntent,
  type ReschedulePayMode,
  RescheduleFlowError,
} from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ rescheduleId: string }>
}

type ConfirmBody = {
  payMode?: string
  reason?: string | null
  overridePolicy?: boolean
}

function parsePayMode(value: unknown): ReschedulePayMode {
  if (value === 'ONLINE') return 'ONLINE'
  if (value === 'OFFLINE') return 'OFFLINE'
  return 'NONE'
}

function asBoolean(value: unknown) {
  return value === true
}

function errorResponse(error: unknown) {
  if (error instanceof IdempotencyConflictError) {
    return NextResponse.json(
      {
        code: 'IDEMPOTENCY_KEY_REUSED',
        error: error.message,
      },
      { status: 409 },
    )
  }
  if (error instanceof RescheduleFlowError) {
    return NextResponse.json(
      {
        code: error.code,
        error: error.message,
        ...(error.details ?? {}),
      },
      { status: error.status },
    )
  }
  throw error
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertFeatureEnabled('reschedule')
  } catch (error) {
    const response = featureErrorResponse(error)
    if (response) return response
    throw error
  }

  const { rescheduleId } = await routeContext.params
  const normalizedRescheduleId = rescheduleId.trim()
  if (!normalizedRescheduleId) {
    return NextResponse.json({ error: 'Invalid reschedule id.' }, { status: 400 })
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const requestHash = hashRequestBody(rawBody || '{}')
  let body: ConfirmBody = {}
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as ConfirmBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
  }

  try {
    const context = await getCabinetContext()
    const access = await resolveIntentRescheduleAccess({
      request,
      context,
      rescheduleId: normalizedRescheduleId,
    })

    const idempotencyKey = readIdempotencyKey(request)
    if (idempotencyKey) {
      const replay = await replayIdempotentResponse<Record<string, unknown>>({
        userId: context.userId,
        operation: 'reschedule.intent.confirm',
        key: idempotencyKey,
        requestHash,
      })
      if (replay) {
        return NextResponse.json(replay.body, { status: replay.statusCode })
      }
    }

    const confirmed = await confirmRescheduleIntent({
      rescheduleId: access.rescheduleId,
      clubId: access.clubId,
      mode: access.mode,
      actorUserId: context.userId,
      payMode: parsePayMode(body.payMode),
      reason: typeof body.reason === 'string' ? body.reason : null,
      allowStaffOverride: access.mode === 'STAFF' ? asBoolean(body.overridePolicy) : false,
    })

    const payload = {
      bookingId: confirmed.bookingId,
      status: confirmed.status,
      slotId: confirmed.slotId,
      seatId: confirmed.seatId,
      checkIn: confirmed.checkIn,
      checkOut: confirmed.checkOut,
      delta: confirmed.delta,
      settlementStatus: confirmed.settlementStatus,
    }

    if (idempotencyKey) {
      await storeIdempotentResponse({
        userId: context.userId,
        operation: 'reschedule.intent.confirm',
        key: idempotencyKey,
        requestHash,
        statusCode: 200,
        body: payload,
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    return errorResponse(error)
  }
}
