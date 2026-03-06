import { NextRequest, NextResponse } from 'next/server'
import { ScheduleTemplateStatus } from '@prisma/client'
import { canAccessClub, canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  normalizeScheduleTemplateInput,
  parseWeeklyHoursJson,
  serializeWeeklyHours,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function parseStatus(value: unknown) {
  if (value === ScheduleTemplateStatus.ACTIVE) return ScheduleTemplateStatus.ACTIVE
  if (value === ScheduleTemplateStatus.DRAFT) return ScheduleTemplateStatus.DRAFT
  if (value === ScheduleTemplateStatus.ARCHIVED) return ScheduleTemplateStatus.ARCHIVED
  return null
}

function templateResponse(template: {
  id: string
  clubId: string
  name: string
  status: ScheduleTemplateStatus
  defaultHorizonDays: number
  slotDurationMinutes: number
  slotStepMinutes: number
  breakBufferMinutes: number
  fixedStartsOnly: boolean
  bookingLeadTimeMinutes: number
  maxAdvanceDays: number
  weeklyHoursJson: string
  effectiveFrom: Date | null
  revision: number
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: template.id,
    clubId: template.clubId,
    name: template.name,
    status: template.status,
    defaultHorizonDays: template.defaultHorizonDays,
    slotDurationMinutes: template.slotDurationMinutes,
    slotStepMinutes: template.slotStepMinutes,
    breakBufferMinutes: template.breakBufferMinutes,
    fixedStartsOnly: template.fixedStartsOnly,
    bookingLeadTimeMinutes: template.bookingLeadTimeMinutes,
    maxAdvanceDays: template.maxAdvanceDays,
    weeklyHours: parseWeeklyHoursJson(template.weeklyHoursJson),
    effectiveFrom: template.effectiveFrom,
    revision: template.revision,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
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

  const items = await prisma.scheduleTemplate.findMany({
    where: { clubId },
    orderBy: [{ updatedAt: 'desc' }],
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
    take: 20,
  })

  return NextResponse.json({ items: items.map(templateResponse) })
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
  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const normalized = normalizeScheduleTemplateInput(record)
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

  const requestedStatus = parseStatus(record.status)
  const existing = await prisma.scheduleTemplate.findUnique({
    where: { clubId },
    select: { id: true, revision: true, status: true },
  })

  const created = await prisma.scheduleTemplate.upsert({
    where: { clubId },
    create: {
      clubId,
      name: normalized.value.name,
      status: requestedStatus ?? ScheduleTemplateStatus.ACTIVE,
      defaultHorizonDays: normalized.value.defaultHorizonDays,
      slotDurationMinutes: normalized.value.slotDurationMinutes,
      slotStepMinutes: normalized.value.slotStepMinutes,
      breakBufferMinutes: normalized.value.breakBufferMinutes,
      fixedStartsOnly: normalized.value.fixedStartsOnly,
      bookingLeadTimeMinutes: normalized.value.bookingLeadTimeMinutes,
      maxAdvanceDays: normalized.value.maxAdvanceDays,
      weeklyHoursJson: serializeWeeklyHours(normalized.value.weeklyHours),
      effectiveFrom: normalized.value.effectiveFrom,
      revision: 1,
    },
    update: {
      name: normalized.value.name,
      status: requestedStatus ?? existing?.status ?? ScheduleTemplateStatus.ACTIVE,
      defaultHorizonDays: normalized.value.defaultHorizonDays,
      slotDurationMinutes: normalized.value.slotDurationMinutes,
      slotStepMinutes: normalized.value.slotStepMinutes,
      breakBufferMinutes: normalized.value.breakBufferMinutes,
      fixedStartsOnly: normalized.value.fixedStartsOnly,
      bookingLeadTimeMinutes: normalized.value.bookingLeadTimeMinutes,
      maxAdvanceDays: normalized.value.maxAdvanceDays,
      weeklyHoursJson: serializeWeeklyHours(normalized.value.weeklyHours),
      effectiveFrom: normalized.value.effectiveFrom,
      revision: (existing?.revision ?? 0) + 1,
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
      clubId,
      actorUserId: context.userId,
      action: 'schedule.template_updated',
      entityType: 'schedule_template',
      entityId: created.id,
      metadata: JSON.stringify({
        status: created.status,
        revision: created.revision,
        slotDurationMinutes: created.slotDurationMinutes,
        slotStepMinutes: created.slotStepMinutes,
        breakBufferMinutes: created.breakBufferMinutes,
      }),
    },
  })

  return NextResponse.json({ template: templateResponse(created) }, { status: existing ? 200 : 201 })
}
