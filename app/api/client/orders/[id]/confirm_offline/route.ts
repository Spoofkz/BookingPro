import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CommerceError, finalizeOwnedOrder } from '@/src/lib/commerceService'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type Payload = {
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  guests?: number
  notes?: string
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const orderId = id.trim()
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id.' }, { status: 400 })
  }

  const idempotencyKey = readIdempotencyKey(request)
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        error: 'Idempotency-Key header is required.',
      },
      { status: 400 },
    )
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
  } catch {
    rawBody = ''
  }
  const requestHash = hashRequestBody(rawBody || '{}')

  let payload: Payload = {}
  try {
    payload = (rawBody ? JSON.parse(rawBody) : {}) as Payload
  } catch {
    payload = {}
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const replay = await replayIdempotentResponse<Record<string, unknown>>({
      userId: context.userId,
      operation: 'order.confirm_offline',
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, { status: replay.statusCode })
    }

    const result = await finalizeOwnedOrder({
      orderId,
      userId: context.userId,
      paymentMode: 'OFFLINE',
      markPaid: false,
      guestName: payload.guestName || null,
      guestEmail: payload.guestEmail || null,
      guestPhone: payload.guestPhone || null,
      guests: payload.guests ?? null,
      notes: payload.notes || null,
    })
    await storeIdempotentResponse({
      userId: context.userId,
      operation: 'order.confirm_offline',
      key: idempotencyKey,
      requestHash,
      statusCode: 200,
      body: result,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        {
          code: 'IDEMPOTENCY_KEY_REUSED',
          error: error.message,
        },
        { status: 409 },
      )
    }
    if (error instanceof CommerceError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to confirm offline order.' }, { status: 500 })
  }
}
