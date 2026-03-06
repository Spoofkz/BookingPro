import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  normalizeScheduleTemplateInput,
  parseWeeklyHoursJson,
  serializeWeeklyHours,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params
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

  const existing = await prisma.scheduleTemplate.findUnique({
    where: { id },
    select: {
      id: true,
      clubId: true,
      name: true,
      status: true,
      defaultHorizonDays: true,
      slotDurationMinutes: true,
      slotStepMinutes: true,
      breakBufferMinutes: true,
      fixedStartsOnly: true,
      bookingLeadTimeMinutes: true,
      maxAdvanceDays: true,
      weeklyHoursJson: true,
      effectiveFrom: true,
      revision: true,
    },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Schedule template was not found.' }, { status: 404 })
  }
  if (!canManageClubAsTechAdmin(context, existing.clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const weeklyHours = parseWeeklyHoursJson(existing.weeklyHoursJson)
  if (!weeklyHours) {
    return NextResponse.json({ error: 'Stored schedule template is corrupted.' }, { status: 500 })
  }

  const effectiveFromRaw =
    record.effectiveFrom === null
      ? null
      : typeof record.effectiveFrom === 'string'
        ? record.effectiveFrom
        : existing.effectiveFrom?.toISOString() ?? null

  const normalized = normalizeScheduleTemplateInput({
    name: typeof record.name === 'string' ? record.name : existing.name,
    slotDurationMinutes: record.slotDurationMinutes ?? existing.slotDurationMinutes,
    slotStepMinutes: record.slotStepMinutes ?? existing.slotStepMinutes,
    breakBufferMinutes: record.breakBufferMinutes ?? existing.breakBufferMinutes,
    fixedStartsOnly: record.fixedStartsOnly ?? existing.fixedStartsOnly,
    bookingLeadTimeMinutes: record.bookingLeadTimeMinutes ?? existing.bookingLeadTimeMinutes,
    maxAdvanceDays: record.maxAdvanceDays ?? existing.maxAdvanceDays,
    defaultHorizonDays: record.defaultHorizonDays ?? existing.defaultHorizonDays,
    weeklyHours: record.weeklyHours ?? weeklyHours,
    effectiveFrom: effectiveFromRaw,
  })
  if (!normalized.value) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Template validation failed.',
        errors: normalized.errors,
      },
      { status: 400 },
    )
  }

  const updated = await prisma.scheduleTemplate.update({
    where: { id: existing.id },
    data: {
      name: normalized.value.name,
      defaultHorizonDays: normalized.value.defaultHorizonDays,
      slotDurationMinutes: normalized.value.slotDurationMinutes,
      slotStepMinutes: normalized.value.slotStepMinutes,
      breakBufferMinutes: normalized.value.breakBufferMinutes,
      fixedStartsOnly: normalized.value.fixedStartsOnly,
      bookingLeadTimeMinutes: normalized.value.bookingLeadTimeMinutes,
      maxAdvanceDays: normalized.value.maxAdvanceDays,
      weeklyHoursJson: serializeWeeklyHours(normalized.value.weeklyHours),
      effectiveFrom: normalized.value.effectiveFrom,
      revision: existing.revision + 1,
    },
    select: {
      id: true,
      clubId: true,
      name: true,
      status: true,
      defaultHorizonDays: true,
      slotDurationMinutes: true,
      slotStepMinutes: true,
      breakBufferMinutes: true,
      fixedStartsOnly: true,
      bookingLeadTimeMinutes: true,
      maxAdvanceDays: true,
      weeklyHoursJson: true,
      effectiveFrom: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: existing.clubId,
      actorUserId: context.userId,
      action: 'schedule.template_updated',
      entityType: 'schedule_template',
      entityId: existing.id,
      metadata: JSON.stringify({
        status: updated.status,
        revision: updated.revision,
        slotDurationMinutes: updated.slotDurationMinutes,
        slotStepMinutes: updated.slotStepMinutes,
      }),
    },
  })

  return NextResponse.json({
    template: {
      id: updated.id,
      clubId: updated.clubId,
      name: updated.name,
      status: updated.status,
      defaultHorizonDays: updated.defaultHorizonDays,
      slotDurationMinutes: updated.slotDurationMinutes,
      slotStepMinutes: updated.slotStepMinutes,
      breakBufferMinutes: updated.breakBufferMinutes,
      fixedStartsOnly: updated.fixedStartsOnly,
      bookingLeadTimeMinutes: updated.bookingLeadTimeMinutes,
      maxAdvanceDays: updated.maxAdvanceDays,
      weeklyHours: parseWeeklyHoursJson(updated.weeklyHoursJson),
      effectiveFrom: updated.effectiveFrom,
      revision: updated.revision,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  })
}
