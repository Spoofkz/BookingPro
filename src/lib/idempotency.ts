import { createHash } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

type DbClient = PrismaClient | Prisma.TransactionClient

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_TTL_HOURS = 24

export type IdempotencyReplay<T> = {
  replayed: true
  statusCode: number
  body: T
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with a different payload.')
  }
}

export function readIdempotencyKey(request: Request) {
  const value = request.headers.get(IDEMPOTENCY_KEY_HEADER)
  if (!value) return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized
}

export function hashRequestBody(rawBody: string) {
  return createHash('sha256').update(rawBody).digest('hex')
}

export async function replayIdempotentResponse<T>(params: {
  db?: DbClient
  userId: string
  operation: string
  key: string
  requestHash: string
  now?: Date
}): Promise<IdempotencyReplay<T> | null> {
  const db = params.db ?? prisma
  const now = params.now ?? new Date()
  const existing = await db.idempotencyRecord.findUnique({
    where: {
      userId_operation_key: {
        userId: params.userId,
        operation: params.operation,
        key: params.key,
      },
    },
    select: {
      id: true,
      requestHash: true,
      responseJson: true,
      statusCode: true,
      expiresAt: true,
    },
  })
  if (!existing) return null

  if (existing.expiresAt <= now) {
    await db.idempotencyRecord.delete({
      where: { id: existing.id },
    })
    return null
  }

  if (existing.requestHash !== params.requestHash) {
    throw new IdempotencyConflictError()
  }

  let parsed: T
  try {
    parsed = JSON.parse(existing.responseJson) as T
  } catch {
    parsed = {} as T
  }

  return {
    replayed: true,
    statusCode: existing.statusCode,
    body: parsed,
  }
}

export async function storeIdempotentResponse(params: {
  db?: DbClient
  userId: string
  operation: string
  key: string
  requestHash: string
  statusCode: number
  body: unknown
  now?: Date
  ttlHours?: number
}) {
  const db = params.db ?? prisma
  const now = params.now ?? new Date()
  const ttlHours = params.ttlHours ?? IDEMPOTENCY_TTL_HOURS
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000)

  await db.idempotencyRecord.upsert({
    where: {
      userId_operation_key: {
        userId: params.userId,
        operation: params.operation,
        key: params.key,
      },
    },
    create: {
      userId: params.userId,
      operation: params.operation,
      key: params.key,
      requestHash: params.requestHash,
      statusCode: params.statusCode,
      responseJson: JSON.stringify(params.body),
      expiresAt,
    },
    update: {
      requestHash: params.requestHash,
      statusCode: params.statusCode,
      responseJson: JSON.stringify(params.body),
      expiresAt,
    },
  })
}

