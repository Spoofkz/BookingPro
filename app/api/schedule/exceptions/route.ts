import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import { canAccessClub, canOperateSchedule, hasClubRole } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { computeScheduleExceptionImpact } from '@/src/lib/schedulePlanService'
import {
  hasOverlapWithExistingException,
  normalizeExceptionInput,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function parseDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export async function GET(request: NextRequest) {
  const clubId = request.nextUrl.searchParams.get('clubId')?.trim() || ''
  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }
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

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let payload: unknown
  try {
    payload = (await request.json()) as unknown
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Payload must be an object.' }, { status: 400 })
  }
  const record = payload as Record<string, unknown>
  const clubId = typeof record.clubId === 'string' ? record.clubId.trim() : ''
  if (!clubId) {
    return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
  }
  if (!canOperateSchedule(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  const isTech = hasClubRole(context, clubId, Role.TECH_ADMIN)

  const normalized = normalizeExceptionInput(record)
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

  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required.' }, { status: 400 })
  }
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const scopeType = typeof record.scopeType === 'string' ? record.scopeType.trim().toUpperCase() : 'CLUB'
  const scopeRefId = typeof record.scopeRefId === 'string' ? record.scopeRefId.trim() || null : null
  const behavior = typeof record.behavior === 'string' ? record.behavior.trim() || null : null
  const isEvent = record.isEvent === true
  if (!isTech) {
    if (!['CLUB', 'ROOM'].includes(scopeType)) {
      return NextResponse.json(
        { error: 'Host can create exceptions only for CLUB or ROOM scopes.' },
        { status: 403 },
      )
    }
  }
  if (normalized.value && normalized.value.startAt < new Date()) {
    return NextResponse.json(
      { error: 'Editing past schedule ranges is blocked by policy.' },
      { status: 409 },
    )
  }

  const existing = await prisma.scheduleException.findMany({
    where: {
      clubId,
      deletedAt: null,
      startAt: { lt: normalized.value.endAt },
      endAt: { gt: normalized.value.startAt },
    },
    select: { id: true, startAt: true, endAt: true },
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
      scopeType,
      scopeRefId,
      behavior,
      isEvent,
      startAt: normalized.value.startAt,
      endAt: normalized.value.endAt,
      reason,
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

  const impact = await computeScheduleExceptionImpact({
    clubId,
    startAt: created.startAt,
    endAt: created.endAt,
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
        impact,
      }),
    },
  })

  return NextResponse.json({
    exception: created,
    impactPreview: impact,
  }, { status: 201 })
}
