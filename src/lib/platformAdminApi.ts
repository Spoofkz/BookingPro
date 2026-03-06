import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { PlatformAuthorizationError } from '@/src/lib/platformAdmin'

export function adminErrorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) {
    return NextResponse.json(
      { code: error.code, error: error.message },
      { status: error.status },
    )
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
}

export function parseDateOrNull(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export function parseIntParam(value: string | null | undefined, fallback: number) {
  const parsed = Number(value ?? '')
  if (!Number.isFinite(parsed)) return fallback
  return Math.trunc(parsed)
}

export function parsePage(searchParams: URLSearchParams) {
  const page = Math.max(1, parseIntParam(searchParams.get('page'), 1))
  const pageSize = Math.min(100, Math.max(1, parseIntParam(searchParams.get('pageSize'), 20)))
  const skip = (page - 1) * pageSize
  return { page, pageSize, skip }
}

export function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function requireOverrideReason(input: unknown) {
  const payload =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const reasonCode = asTrimmedString(payload.reasonCode)
  const reason = asTrimmedString(payload.reason)
  if (!reasonCode || !reason) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          code: 'VALIDATION_ERROR',
          error: 'reasonCode and reason are required.',
        },
        { status: 400 },
      ),
    }
  }
  return {
    ok: true as const,
    value: {
      reasonCode: reasonCode.slice(0, 50),
      reason: reason.slice(0, 500),
    },
    payload,
  }
}

export async function createPlatformAuditLog(params: {
  actorUserId: string
  action: string
  entityType: string
  entityId: string
  clubId?: string | null
  bookingId?: number | null
  metadata?: Record<string, unknown> | null
  tx?: Prisma.TransactionClient
}) {
  const client = params.tx ?? prisma
  await client.auditLog.create({
    data: {
      clubId: params.clubId ?? null,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      bookingId: params.bookingId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

