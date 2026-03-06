import { NextRequest, NextResponse } from 'next/server'
import { BookingStatus } from '@prisma/client'
import { canAccessClub, canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  defaultWeeklyHours,
  DEFAULT_BOOKING_LEAD_TIME_MINUTES,
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_SLOT_DURATION_MINUTES,
  normalizeScheduleTemplateInput,
  parseWeeklyHoursJson,
  serializeWeeklyHours,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function responsePayload(template: {
  id: string
  name: string
  status: string
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
  updatedAt: Date
}) {
  return {
    id: template.id,
    name: template.name,
    status: template.status,
    defaultHorizonDays: template.defaultHorizonDays,
    slotDurationMinutes: template.slotDurationMinutes,
    slotStepMinutes: template.slotStepMinutes,
    breakBufferMinutes: template.breakBufferMinutes,
    fixedStartsOnly: template.fixedStartsOnly,
    bookingLeadTimeMinutes: template.bookingLeadTimeMinutes,
    maxAdvanceDays: template.maxAdvanceDays,
    weeklyHours: parseWeeklyHoursJson(template.weeklyHoursJson) ?? defaultWeeklyHours(),
    effectiveFrom: template.effectiveFrom,
    revision: template.revision,
    updatedAt: template.updatedAt,
  }
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, timezone: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const template = await prisma.scheduleTemplate.findUnique({
    where: { clubId },
    select: {
      id: true,
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
      updatedAt: true,
    },
  })

  if (!template) {
    return NextResponse.json({
      exists: false,
      template: {
        id: null,
        name: 'Default schedule',
        status: 'ACTIVE',
        defaultHorizonDays: DEFAULT_MAX_ADVANCE_DAYS,
        slotDurationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
        slotStepMinutes: DEFAULT_SLOT_DURATION_MINUTES,
        breakBufferMinutes: 0,
        fixedStartsOnly: false,
        bookingLeadTimeMinutes: DEFAULT_BOOKING_LEAD_TIME_MINUTES,
        maxAdvanceDays: DEFAULT_MAX_ADVANCE_DAYS,
        weeklyHours: defaultWeeklyHours(),
        effectiveFrom: null,
        revision: 0,
        updatedAt: null,
      },
      timezone: club.timezone,
    })
  }

  return NextResponse.json({
    exists: true,
    template: responsePayload(template),
    timezone: club.timezone,
  })
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
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

  const normalized = normalizeScheduleTemplateInput(payload)
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

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, timezone: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  const data = normalized.value
  const current = await prisma.scheduleTemplate.findUnique({
    where: { clubId },
    select: { id: true, revision: true, slotDurationMinutes: true },
  })

  const durationChanged =
    current != null && current.slotDurationMinutes !== data.slotDurationMinutes
  if (durationChanged) {
    const now = new Date()
    if (!data.effectiveFrom || data.effectiveFrom <= now) {
      const hasFutureBookedSlots = await prisma.booking.findFirst({
        where: {
          clubId,
          slotId: { not: null },
          checkIn: { gte: now },
          status: {
            in: [BookingStatus.HELD, BookingStatus.PENDING, BookingStatus.CONFIRMED],
          },
        },
        select: { id: true },
      })
      if (hasFutureBookedSlots) {
        return NextResponse.json(
          {
            code: 'EFFECTIVE_FROM_REQUIRED',
            error:
              'Changing slot duration requires a future effectiveFrom date because future slot bookings exist.',
          },
          { status: 409 },
        )
      }
    }
  }

  const template = await prisma.scheduleTemplate.upsert({
    where: { clubId },
    create: {
      clubId,
      name: data.name,
      status: 'ACTIVE',
      defaultHorizonDays: data.defaultHorizonDays,
      slotDurationMinutes: data.slotDurationMinutes,
      slotStepMinutes: data.slotStepMinutes,
      breakBufferMinutes: data.breakBufferMinutes,
      fixedStartsOnly: data.fixedStartsOnly,
      bookingLeadTimeMinutes: data.bookingLeadTimeMinutes,
      maxAdvanceDays: data.maxAdvanceDays,
      weeklyHoursJson: serializeWeeklyHours(data.weeklyHours),
      effectiveFrom: data.effectiveFrom,
      revision: 1,
    },
    update: {
      name: data.name,
      defaultHorizonDays: data.defaultHorizonDays,
      slotDurationMinutes: data.slotDurationMinutes,
      slotStepMinutes: data.slotStepMinutes,
      breakBufferMinutes: data.breakBufferMinutes,
      fixedStartsOnly: data.fixedStartsOnly,
      bookingLeadTimeMinutes: data.bookingLeadTimeMinutes,
      maxAdvanceDays: data.maxAdvanceDays,
      weeklyHoursJson: serializeWeeklyHours(data.weeklyHours),
      effectiveFrom: data.effectiveFrom,
      revision: (current?.revision ?? 0) + 1,
    },
    select: {
      id: true,
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
      updatedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'schedule.template_updated',
      entityType: 'schedule_template',
      entityId: template.id,
      metadata: JSON.stringify({
        slotDurationMinutes: template.slotDurationMinutes,
        slotStepMinutes: template.slotStepMinutes,
        breakBufferMinutes: template.breakBufferMinutes,
        fixedStartsOnly: template.fixedStartsOnly,
        defaultHorizonDays: template.defaultHorizonDays,
        bookingLeadTimeMinutes: template.bookingLeadTimeMinutes,
        maxAdvanceDays: template.maxAdvanceDays,
        revision: template.revision,
      }),
    },
  })

  return NextResponse.json({
    template: responsePayload(template),
    timezone: club.timezone,
  })
}
