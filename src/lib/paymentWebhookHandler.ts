import { NextRequest, NextResponse } from 'next/server'
import {
  processPaymentWebhook,
  resolvePaymentIntentForWebhook,
  CommerceError,
} from '@/src/lib/commerceService'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import { verifyWebhookSignature } from '@/src/lib/paymentWebhook'
import { prisma } from '@/src/lib/prisma'

type WebhookPayload = {
  intentId?: string
  providerRef?: string
  status?: 'PAID' | 'FAILED' | 'CANCELED'
}

function normalizeProvider(input: string | null | undefined) {
  const normalized = (input || '').trim().toUpperCase()
  if (!normalized) return 'MOCK_PROVIDER'
  return normalized
}

export async function handlePaymentWebhook(
  request: NextRequest,
  providerFromRoute?: string | null,
) {
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
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }
  const requestHash = hashRequestBody(rawBody || '{}')

  let payload: WebhookPayload
  try {
    payload = (rawBody ? JSON.parse(rawBody) : {}) as WebhookPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const provider = normalizeProvider(providerFromRoute || request.headers.get('x-webhook-provider'))
  const signature = request.headers.get('x-webhook-signature')
  const verified = verifyWebhookSignature({
    provider,
    rawBody: rawBody || '',
    signature,
  })
  if (!verified) {
    await prisma.auditLog.create({
      data: {
        clubId: null,
        actorUserId: null,
        action: 'payment.webhook.failed',
        entityType: 'payment_webhook',
        entityId: provider,
        metadata: JSON.stringify({
          reason: 'signature_invalid',
        }),
      },
    })
    return NextResponse.json(
      { code: 'INVALID_WEBHOOK_SIGNATURE', error: 'Webhook signature verification failed.' },
      { status: 401 },
    )
  }

  const status = payload.status
  if (!status || !['PAID', 'FAILED', 'CANCELED'].includes(status)) {
    return NextResponse.json(
      { error: 'status must be PAID, FAILED, or CANCELED.' },
      { status: 400 },
    )
  }
  const intentId = payload.intentId?.trim() || null
  const providerRef = payload.providerRef?.trim() || null
  if (!intentId && !providerRef) {
    return NextResponse.json({ error: 'intentId or providerRef is required.' }, { status: 400 })
  }

  const intent = await resolvePaymentIntentForWebhook({ intentId, providerRef })
  if (!intent) {
    return NextResponse.json({ code: 'INTENT_NOT_FOUND', error: 'Payment intent not found.' }, { status: 404 })
  }

  try {
    const replay = await replayIdempotentResponse<Record<string, unknown>>({
      userId: intent.userId,
      operation: `payment.webhook.${provider}`,
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, { status: replay.statusCode })
    }
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return NextResponse.json(
        { code: 'IDEMPOTENCY_KEY_REUSED', error: error.message },
        { status: 409 },
      )
    }
    throw error
  }

  await prisma.auditLog.create({
    data: {
      clubId: intent.clubId,
      actorUserId: null,
      action: 'payment.webhook.verified',
      entityType: 'payment_intent',
      entityId: intent.id,
      metadata: JSON.stringify({
        provider,
        providerRef: intent.providerRef,
        status,
      }),
    },
  })

  try {
    const result = await processPaymentWebhook({
      intentId,
      providerRef,
      status,
      provider,
    })
    await storeIdempotentResponse({
      userId: intent.userId,
      operation: `payment.webhook.${provider}`,
      key: idempotencyKey,
      requestHash,
      statusCode: 200,
      body: result,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CommerceError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to process payment webhook.' }, { status: 500 })
  }
}
