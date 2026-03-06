import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub, canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  hasOverlapWithExistingException,
  normalizeExceptionInput,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const from = parseDate(request.nextUrl.searchParams.get('from'))
  const to = parseDate(request.nextUrl.searchParams.get('to'))
  if ((request.nextUrl.searchParams.get('from') && !from) || (request.nextUrl.searchParams.get('to') && !to)) {
    return NextResponse.json({ error: 'from/to must be valid ISO datetime values.' }, { status: 400 })
  }
  if (from && to && to <= from) {
    return NextResponse.json({ error: 'to must be greater than from.' }, { status: 400 })
  }

  const where: {
    clubId: string
    deletedAt: null
    startAt?: { lt: Date }
    endAt?: { gt: Date }
  } = { clubId, deletedAt: null }
  if (to) where.startAt = { lt: to }
  if (from) where.endAt = { gt: from }

  const items = await prisma.scheduleException.findMany({
    where,
    orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      type: true,
      scopeType: true,
      scopeRefId: true,
      behavior: true,
      isEvent: true,
      startAt: true,
      endAt: true,
      reason: true,
      createdAt: true,
      updatedAt: true,
      createdByUserId: true,
    },
  })

  return NextResponse.json({ items })
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = (await request.json()) as unknown
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const normalized = normalizeExceptionInput(payload)
  const reason =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).reason === 'string'
      ? (payload as Record<string, string>).reason.trim()
      : ''
  const title =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).title === 'string'
      ? (payload as Record<string, string>).title.trim()
      : ''
  const scopeTypeRaw =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).scopeType === 'string'
      ? (payload as Record<string, string>).scopeType.trim().toUpperCase()
      : 'CLUB'
  const scopeRefId =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).scopeRefId === 'string'
      ? (payload as Record<string, string>).scopeRefId.trim() || null
      : null
  const behavior =
    payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).behavior === 'string'
      ? (payload as Record<string, string>).behavior.trim() || null
      : null
  const isEvent =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).isEvent === true
      : false

  if (!normalized.value) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Exception validation failed.',
        errors: normalized.errors,
      },
      { status: 400 },
    )
  }

  const existing = await prisma.scheduleException.findMany({
    where: {
      clubId,
      deletedAt: null,
      startAt: { lt: normalized.value.endAt },
      endAt: { gt: normalized.value.startAt },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
    },
  })

  const overlapped = hasOverlapWithExistingException(existing, normalized.value)
  if (overlapped) {
    return NextResponse.json(
      {
        code: 'EXCEPTION_OVERLAP',
        error: 'Exception overlaps with an existing exception.',
        conflictExceptionId: overlapped.id,
      },
      { status: 409 },
    )
  }

  const created = await prisma.scheduleException.create({
    data: {
      clubId,
      title: title || null,
      type: normalized.value.type,
      scopeType: scopeTypeRaw || 'CLUB',
      scopeRefId,
      behavior,
      isEvent,
      startAt: normalized.value.startAt,
      endAt: normalized.value.endAt,
      reason: reason || null,
      createdByUserId: context.userId,
    },
    select: {
      id: true,
      title: true,
      type: true,
      scopeType: true,
      scopeRefId: true,
      behavior: true,
      isEvent: true,
      startAt: true,
      endAt: true,
      reason: true,
      createdAt: true,
      updatedAt: true,
      createdByUserId: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'schedule.exception_created',
      entityType: 'schedule_exception',
      entityId: created.id,
      metadata: JSON.stringify({
        type: created.type,
        scopeType: created.scopeType,
        scopeRefId: created.scopeRefId,
        isEvent: created.isEvent,
        startAt: created.startAt.toISOString(),
        endAt: created.endAt.toISOString(),
      }),
    },
  })

  return NextResponse.json(created, { status: 201 })
}
