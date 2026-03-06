import { BookingStatus, SlotStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClub } from '@/src/lib/availabilityCache'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import {
  addDaysLocalDate,
  generateSlots,
  localDateNow,
  parseWeeklyHoursJson,
  startOfLocalDateUtc,
  templateSignature,
  utcMinuteKey,
} from '@/src/lib/scheduleEngine'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type PublishPayload = {
  horizonDays?: number
}

function activeBookingStatuses() {
  return [
    BookingStatus.HELD,
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
  ]
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: PublishPayload = {}
  try {
    payload = (await request.json()) as PublishPayload
  } catch {
    payload = {}
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
      defaultHorizonDays: true,
      slotDurationMinutes: true,
      slotStepMinutes: true,
      breakBufferMinutes: true,
      bookingLeadTimeMinutes: true,
      maxAdvanceDays: true,
      weeklyHoursJson: true,
      revision: true,
      effectiveFrom: true,
    },
  })
  if (!template) {
    return NextResponse.json(
      {
        code: 'SCHEDULE_TEMPLATE_REQUIRED',
        error: 'Schedule template is not configured.',
      },
      { status: 409 },
    )
  }

  const weeklyHours = parseWeeklyHoursJson(template.weeklyHoursJson)
  if (!weeklyHours) {
    return NextResponse.json({ error: 'Stored schedule template is corrupted.' }, { status: 500 })
  }

  const requestedHorizon =
    payload.horizonDays == null ? template.defaultHorizonDays : Number(payload.horizonDays)
  if (!Number.isInteger(requestedHorizon) || requestedHorizon < 1 || requestedHorizon > 120) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'horizonDays must be an integer between 1 and 120.',
      },
      { status: 400 },
    )
  }

  const now = new Date()
  const baseFromLocalDate = localDateNow(club.timezone, now)
  const effectiveFromLocalDate = template.effectiveFrom
    ? localDateNow(club.timezone, template.effectiveFrom)
    : null
  const fromLocalDate =
    effectiveFromLocalDate && effectiveFromLocalDate > baseFromLocalDate
      ? effectiveFromLocalDate
      : baseFromLocalDate
  const toLocalDate = addDaysLocalDate(fromLocalDate, requestedHorizon) ?? fromLocalDate
  const rangeStartUtc = startOfLocalDateUtc(fromLocalDate, club.timezone) ?? now
  const nextDate = addDaysLocalDate(toLocalDate, 1) ?? toLocalDate
  const rangeEndUtc =
    startOfLocalDateUtc(nextDate, club.timezone) ?? new Date(rangeStartUtc.getTime() + 24 * 60 * 60 * 1000)

  const exceptions = await prisma.scheduleException.findMany({
    where: {
      clubId,
      deletedAt: null,
      startAt: { lt: rangeEndUtc },
      endAt: { gt: rangeStartUtc },
    },
    select: {
      type: true,
      startAt: true,
      endAt: true,
    },
  })

  const generated = generateSlots({
    timeZone: club.timezone,
    fromLocalDate,
    toLocalDate,
    slotDurationMinutes: template.slotDurationMinutes,
    slotStepMinutes: template.slotStepMinutes,
    breakBufferMinutes: template.breakBufferMinutes,
    weeklyHours,
    exceptions,
  })

  const generatedByKey = new Map<string, (typeof generated)[number]>()
  for (const item of generated) {
    generatedByKey.set(utcMinuteKey(item.startAtUtc, item.endAtUtc), item)
  }

  const existingSlots = await prisma.slot.findMany({
    where: {
      clubId,
      startAtUtc: { gte: rangeStartUtc, lt: rangeEndUtc },
    },
    select: {
      id: true,
      startAtUtc: true,
      endAtUtc: true,
      localDate: true,
      status: true,
    },
  })

  const existingByKey = new Map<string, (typeof existingSlots)[number]>()
  for (const slot of existingSlots) {
    existingByKey.set(utcMinuteKey(slot.startAtUtc, slot.endAtUtc), slot)
  }

  const existingSlotIds = existingSlots.map((slot) => slot.id)
  const activeBookings = existingSlotIds.length
    ? await prisma.booking.findMany({
        where: {
          clubId,
          slotId: { in: existingSlotIds },
          status: { in: activeBookingStatuses() },
        },
        select: { slotId: true },
      })
    : []
  const lockedSlotIds = new Set(
    activeBookings
      .map((booking) => booking.slotId)
      .filter((value): value is string => Boolean(value)),
  )

  const signature = templateSignature({
    templateId: template.id,
    revision: template.revision,
    slotDurationMinutes: template.slotDurationMinutes,
    weeklyHours,
  })

  const creates: Array<{
    clubId: string
    startAtUtc: Date
    endAtUtc: Date
    localDate: string
    status: SlotStatus
    generatedFrom: string
  }> = []
  const updates: Array<{
    id: string
    status: SlotStatus
    localDate: string
  }> = []
  const deleteIds: string[] = []
  const lockOutsideIds: string[] = []

  let created = 0
  let updated = 0
  let blocked = 0
  let locked = 0

  for (const generatedSlot of generated) {
    const key = utcMinuteKey(generatedSlot.startAtUtc, generatedSlot.endAtUtc)
    const existing = existingByKey.get(key)
    const existingLocked = existing ? lockedSlotIds.has(existing.id) : false
    const nextStatus =
      generatedSlot.status === SlotStatus.PUBLISHED
        ? SlotStatus.PUBLISHED
        : existingLocked
          ? SlotStatus.CANCELLED_LOCKED
          : SlotStatus.BLOCKED

    if (nextStatus === SlotStatus.BLOCKED) blocked += 1
    if (nextStatus === SlotStatus.CANCELLED_LOCKED) locked += 1

    if (!existing) {
      creates.push({
        clubId,
        startAtUtc: generatedSlot.startAtUtc,
        endAtUtc: generatedSlot.endAtUtc,
        localDate: generatedSlot.localDate,
        status: nextStatus,
        generatedFrom: signature,
      })
      created += 1
      continue
    }

    if (existing.status !== nextStatus || existing.localDate !== generatedSlot.localDate) {
      updates.push({
        id: existing.id,
        status: nextStatus,
        localDate: generatedSlot.localDate,
      })
      updated += 1
    }
  }

  for (const existing of existingSlots) {
    const key = utcMinuteKey(existing.startAtUtc, existing.endAtUtc)
    if (generatedByKey.has(key)) continue
    if (lockedSlotIds.has(existing.id)) {
      if (existing.status !== SlotStatus.CANCELLED_LOCKED) {
        lockOutsideIds.push(existing.id)
        locked += 1
      }
      continue
    }
    deleteIds.push(existing.id)
  }

  const publishAt = new Date()
  await prisma.$transaction(async (tx) => {
    if (creates.length > 0) {
      await tx.slot.createMany({ data: creates })
    }

    for (const slot of updates) {
      await tx.slot.update({
        where: { id: slot.id },
        data: {
          status: slot.status,
          localDate: slot.localDate,
          generatedFrom: signature,
        },
      })
    }

    if (lockOutsideIds.length > 0) {
      await tx.slot.updateMany({
        where: { id: { in: lockOutsideIds } },
        data: { status: SlotStatus.CANCELLED_LOCKED, generatedFrom: signature },
      })
    }

    if (deleteIds.length > 0) {
      await tx.slot.deleteMany({ where: { id: { in: deleteIds } } })
    }

    await tx.club.update({
      where: { id: clubId },
      data: {
        schedulePublishedAt: publishAt,
        slotsGeneratedUntil: rangeEndUtc,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'schedule.published',
        entityType: 'schedule_template',
        entityId: template.id,
        metadata: JSON.stringify({
          horizonDays: requestedHorizon,
          fromLocalDate,
          toLocalDate,
          created,
          updated,
          blocked,
          locked,
          deleted: deleteIds.length,
          signature,
        }),
      },
    })
  })

  invalidateAvailabilityCacheForClub(clubId)

  return NextResponse.json({
    schedulePublishedAt: publishAt,
    slotsGeneratedUntil: rangeEndUtc,
    result: {
      created,
      updated,
      blocked,
      locked,
      deleted: deleteIds.length,
    },
  })
}
