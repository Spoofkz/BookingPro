import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CommerceError, initOwnedOrderPaymentIntent } from '@/src/lib/commerceService'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ orderId: string }>
}

type Payload = {
  provider?: string
  expiresInMinutes?: number
  mockProviderStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED'
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { orderId } = await routeContext.params
  const resolvedOrderId = orderId.trim()
  if (!resolvedOrderId) {
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
      operation: 'payment.retry',
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, { status: replay.statusCode })
    }

    const intent = await initOwnedOrderPaymentIntent({
      orderId: resolvedOrderId,
      userId: context.userId,
      provider: payload.provider || 'MOCK_PROVIDER',
      expiresInMinutes: payload.expiresInMinutes,
      mockProviderStatus: payload.mockProviderStatus || null,
    })
    const responsePayload = {
      intentId: intent.id,
      status: intent.status,
      provider: intent.provider,
      providerRef: intent.providerRef,
      amountCents: intent.amountCents,
      currency: intent.currency,
      checkoutUrl: `/me/payments?intent=${intent.providerRef || intent.id}`,
    }
    await storeIdempotentResponse({
      userId: context.userId,
      operation: 'payment.retry',
      key: idempotencyKey,
      requestHash,
      statusCode: 200,
      body: responsePayload,
    })
    return NextResponse.json(responsePayload)
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
    return NextResponse.json({ error: 'Failed to retry payment.' }, { status: 500 })
  }
}
