import { OrderStatus, OrderSource } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CommerceError, createClientSeatOrder } from '@/src/lib/commerceService'
import {
  hashRequestBody,
  IdempotencyConflictError,
  readIdempotencyKey,
  replayIdempotentResponse,
  storeIdempotentResponse,
} from '@/src/lib/idempotency'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type CreateOrderPayload = {
  clubId?: string
  holdId?: string
  holdIds?: string[]
  roomId?: number
  packageId?: string
  promoCode?: string
  paymentMode?: 'OFFLINE' | 'ONLINE'
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  guests?: number
  notes?: string
}

function parseOptionalStatus(value: string | null) {
  if (!value) return null
  const normalized = value.trim().toUpperCase()
  if (normalized === OrderStatus.DRAFT) return OrderStatus.DRAFT
  if (normalized === OrderStatus.PENDING_PAYMENT) return OrderStatus.PENDING_PAYMENT
  if (normalized === OrderStatus.AWAITING_OFFLINE_PAYMENT) {
    return OrderStatus.AWAITING_OFFLINE_PAYMENT
  }
  if (normalized === OrderStatus.PAID) return OrderStatus.PAID
  if (normalized === OrderStatus.COMPLETED) return OrderStatus.COMPLETED
  if (normalized === OrderStatus.FAILED) return OrderStatus.FAILED
  if (normalized === OrderStatus.EXPIRED) return OrderStatus.EXPIRED
  if (normalized === OrderStatus.CANCELED) return OrderStatus.CANCELED
  if (normalized === OrderStatus.REFUND_PENDING) return OrderStatus.REFUND_PENDING
  if (normalized === OrderStatus.REFUNDED) return OrderStatus.REFUNDED
  return null
}

export async function GET(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || '1'))
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get('pageSize') || '20')),
    )
    const skip = (page - 1) * pageSize
    const status = parseOptionalStatus(request.nextUrl.searchParams.get('status'))
    const clubId = request.nextUrl.searchParams.get('clubId')?.trim() || null

    const where: {
      userId: string
      status?: OrderStatus
      clubId?: string
      source?: OrderSource
    } = {
      userId: context.userId,
      source: OrderSource.CLIENT,
    }
    if (status) where.status = status
    if (clubId) where.clubId = clubId

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: true,
          invoices: {
            select: { id: true, invoiceNumber: true, issueDate: true, status: true },
            orderBy: [{ issueDate: 'desc' }],
          },
          bookings: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              checkIn: true,
              checkOut: true,
              seatLabelSnapshot: true,
            },
          },
          club: {
            select: { id: true, name: true, slug: true, city: true, address: true },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.order.count({ where }),
    ])

    return NextResponse.json({ items, page, pageSize, total })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
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

  let payload: CreateOrderPayload
  try {
    payload = (rawBody ? JSON.parse(rawBody) : {}) as CreateOrderPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const clubId = payload.clubId?.trim() || ''
  const holdIds = Array.from(
    new Set(
      [payload.holdId || '', ...(payload.holdIds || [])]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
  if (!clubId || holdIds.length < 1) {
    return NextResponse.json(
      { error: 'clubId and at least one holdId are required.' },
      { status: 400 },
    )
  }
  if (payload.roomId != null && (!Number.isInteger(payload.roomId) || payload.roomId < 1)) {
    return NextResponse.json({ error: 'roomId must be a positive integer.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })

    const replay = await replayIdempotentResponse<Record<string, unknown>>({
      userId: context.userId,
      operation: 'order.create',
      key: idempotencyKey,
      requestHash,
    })
    if (replay) {
      return NextResponse.json(replay.body, { status: replay.statusCode })
    }

    const order = await createClientSeatOrder({
      userId: context.userId,
      clubId,
      holdIds,
      roomId: payload.roomId ?? null,
      packageId: payload.packageId?.trim() || null,
      promoCode: payload.promoCode?.trim() || null,
      paymentMode: payload.paymentMode === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
      source: OrderSource.CLIENT,
      guestName: payload.guestName || null,
      guestEmail: payload.guestEmail || null,
      guestPhone: payload.guestPhone || null,
      guests: payload.guests ?? null,
      notes: payload.notes || null,
    })

    await storeIdempotentResponse({
      userId: context.userId,
      operation: 'order.create',
      key: idempotencyKey,
      requestHash,
      statusCode: 201,
      body: order,
    })
    return NextResponse.json(order, { status: 201 })
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
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'Failed to create order.' }, { status: 500 })
  }
}
