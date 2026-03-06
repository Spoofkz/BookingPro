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
import { resolveBookingRescheduleAccess } from '@/src/lib/rescheduleAccess'
import { createRescheduleIntent, RescheduleFlowError } from '@/src/lib/rescheduleService'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type CreateIntentBody = {
  newSlotId?: string
  newSeatId?: string
  packageId?: string | null
  reason?: string | null
  overridePolicy?: boolean
}

function parseBookingId(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
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

  const { id: rawId } = await routeContext.params
  const bookingId = parseBookingId(rawId)
  if (!bookingId) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 })
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const requestHash = hashRequestBody(rawBody || '{}')
  let body: CreateIntentBody = {}
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as CreateIntentBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
  }

  const newSlotId = body.newSlotId?.trim() || ''
  if (!newSlotId) {
    return NextResponse.json({ error: 'newSlotId is required.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext()
    const access = await resolveBookingRescheduleAccess({
      request,
      context,
      bookingId,
    })

    const idempotencyKey = readIdempotencyKey(request)
    if (idempotencyKey) {
      const replay = await replayIdempotentResponse<Record<string, unknown>>({
        userId: context.userId,
        operation: 'reschedule.intent.create',
        key: idempotencyKey,
        requestHash,
      })
      if (replay) {
        return NextResponse.json(replay.body, { status: replay.statusCode })
      }
    }

    const result = await createRescheduleIntent({
      bookingId: access.bookingId,
      clubId: access.clubId,
      mode: access.mode,
      actorUserId: context.userId,
      newSlotId,
      newSeatId: body.newSeatId?.trim() || null,
      packageId:
        body.packageId === null
          ? null
          : body.packageId === undefined
            ? undefined
            : body.packageId.trim() || null,
      reason: typeof body.reason === 'string' ? body.reason : null,
      allowStaffOverride: access.mode === 'STAFF' ? asBoolean(body.overridePolicy) : false,
    })

    if (idempotencyKey) {
      await storeIdempotentResponse({
        userId: context.userId,
        operation: 'reschedule.intent.create',
        key: idempotencyKey,
        requestHash,
        statusCode: 201,
        body: result,
      })
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
