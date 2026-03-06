import {
  BookingStatus,
  SchedulePlanStatus,
  ScheduleTemplateStatus,
  SlotStatus,
} from '@prisma/client'
import { invalidateAvailabilityCacheForClub } from '@/src/lib/availabilityCache'
import {
  addDaysLocalDate,
  generateSlots,
  localDateNow,
  parseWeeklyHoursJson,
  startOfLocalDateUtc,
  templateSignature,
  utcMinuteKey,
} from '@/src/lib/scheduleEngine'
import { prisma } from '@/src/lib/prisma'

type SlotSnapshot = {
  startAtUtc: string
  endAtUtc: string
  localDate: string
  status: SlotStatus
}

type PlanDiffSummary = {
  fromLocalDate: string
  toLocalDate: string
  totalGeneratedSlots: number
  finalSlotCount: number
  created: number
  updated: number
  removed: number
  blocked: number
  locked: number
  changed: number
  closed: number
  touchWindowMinutes: number
  bookingConflicts: number
  warningConflicts: number
  blockerConflicts: number
  touchWindowProtectedSlots: number
  publishMode: 'SAFE' | 'FORCE'
  bookedSlotsPolicy: 'FREEZE' | 'CLOSE'
}

type PlanConflict = {
  code:
    | 'BOOKING_IN_CLOSED_SLOT'
    | 'BOOKING_IN_REMOVED_SLOT'
    | 'SCOPE_COLLISION'
    | 'DST_INVALID_TIME'
    | 'OVERLAPPING_RULES_DUPLICATE_SLOTS'
  slotId: string
  startAtUtc: string
  endAtUtc: string
  bookingCount: number
  severity: 'warning' | 'blocker'
  message: string
  suggestedActions: string[]
}

type ConflictSummary = {
  total: number
  warnings: number
  blockers: number
}

type CreatePlanOptions = {
  touchWindowMinutes: number
  bookedSlotsPolicy: 'FREEZE' | 'CLOSE'
  publishMode: 'SAFE' | 'FORCE'
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

function activeBookingStatuses() {
  return [
    BookingStatus.HELD,
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
  ] as BookingStatus[]
}

function sortSnapshots(left: SlotSnapshot, right: SlotSnapshot) {
  return new Date(left.startAtUtc).getTime() - new Date(right.startAtUtc).getTime()
}

function serializeSnapshot(slot: { startAtUtc: Date; endAtUtc: Date; localDate: string; status: SlotStatus }): SlotSnapshot {
  return {
    startAtUtc: slot.startAtUtc.toISOString(),
    endAtUtc: slot.endAtUtc.toISOString(),
    localDate: slot.localDate,
    status: slot.status,
  }
}

function parseSnapshots(value: string): SlotSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = item as Record<string, unknown>
        return {
          startAtUtc: typeof record.startAtUtc === 'string' ? record.startAtUtc : '',
          endAtUtc: typeof record.endAtUtc === 'string' ? record.endAtUtc : '',
          localDate: typeof record.localDate === 'string' ? record.localDate : '',
          status:
            record.status === SlotStatus.PUBLISHED ||
            record.status === SlotStatus.BLOCKED ||
            record.status === SlotStatus.CANCELLED_LOCKED
              ? record.status
              : SlotStatus.BLOCKED,
        } satisfies SlotSnapshot
      })
      .filter((item) => item.startAtUtc && item.endAtUtc && item.localDate)
      .sort(sortSnapshots)
  } catch {
    return []
  }
}

function parseDiffSummary(value: string): PlanDiffSummary | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (
      typeof record.fromLocalDate !== 'string' ||
      typeof record.toLocalDate !== 'string' ||
      typeof record.totalGeneratedSlots !== 'number' ||
      typeof record.finalSlotCount !== 'number'
    ) {
      return null
    }
    return {
      fromLocalDate: record.fromLocalDate,
      toLocalDate: record.toLocalDate,
      totalGeneratedSlots: Number(record.totalGeneratedSlots),
      finalSlotCount: Number(record.finalSlotCount),
      created: Number(record.created ?? 0),
      updated: Number(record.updated ?? 0),
      removed: Number(record.removed ?? 0),
      blocked: Number(record.blocked ?? 0),
      locked: Number(record.locked ?? 0),
      changed: Number(record.changed ?? 0),
      closed: Number(record.closed ?? Number(record.blocked ?? 0)),
      touchWindowMinutes: Number(record.touchWindowMinutes ?? 0),
      bookingConflicts: Number(record.bookingConflicts ?? 0),
      warningConflicts: Number(record.warningConflicts ?? 0),
      blockerConflicts: Number(record.blockerConflicts ?? 0),
      touchWindowProtectedSlots: Number(record.touchWindowProtectedSlots ?? 0),
      publishMode:
        record.publishMode === 'FORCE'
          ? 'FORCE'
          : 'SAFE',
      bookedSlotsPolicy:
        record.bookedSlotsPolicy === 'CLOSE'
          ? 'CLOSE'
          : 'FREEZE',
    }
  } catch {
    return null
  }
}

function parseConflicts(value: string): PlanConflict[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const record = item as Record<string, unknown>
        const code =
          record.code === 'BOOKING_IN_CLOSED_SLOT' ||
          record.code === 'BOOKING_IN_REMOVED_SLOT' ||
          record.code === 'SCOPE_COLLISION' ||
          record.code === 'DST_INVALID_TIME' ||
          record.code === 'OVERLAPPING_RULES_DUPLICATE_SLOTS'
            ? record.code
            : 'BOOKING_IN_CLOSED_SLOT'
        const severity = record.severity === 'blocker' ? 'blocker' : 'warning'
        return {
          code,
          slotId: typeof record.slotId === 'string' ? record.slotId : '',
          startAtUtc: typeof record.startAtUtc === 'string' ? record.startAtUtc : '',
          endAtUtc: typeof record.endAtUtc === 'string' ? record.endAtUtc : '',
          bookingCount: Number(record.bookingCount ?? 0),
          severity,
          message: typeof record.message === 'string' ? record.message : '',
          suggestedActions: Array.isArray(record.suggestedActions)
            ? record.suggestedActions
                .filter((item) => typeof item === 'string')
                .map((item) => String(item))
            : [],
        } satisfies PlanConflict
      })
      .filter((item) => item.slotId && item.startAtUtc && item.endAtUtc)
  } catch {
    return []
  }
}

function summarizeConflicts(conflicts: PlanConflict[]): ConflictSummary {
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warning').length
  const blockers = conflicts.filter((conflict) => conflict.severity === 'blocker').length
  return {
    total: conflicts.length,
    warnings,
    blockers,
  }
}

function parseCreatePlanOptions(value: unknown): CreatePlanOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      touchWindowMinutes: 240,
      bookedSlotsPolicy: 'FREEZE',
      publishMode: 'SAFE',
    }
  }
  const record = value as Record<string, unknown>
  const touchWindow =
    typeof record.touchWindowMinutes === 'number' && Number.isInteger(record.touchWindowMinutes)
      ? Math.min(Math.max(record.touchWindowMinutes, 0), 1440)
      : 240
  return {
    touchWindowMinutes: touchWindow,
    bookedSlotsPolicy: record.bookedSlotsPolicy === 'CLOSE' ? 'CLOSE' : 'FREEZE',
    publishMode: record.publishMode === 'FORCE' ? 'FORCE' : 'SAFE',
  }
}

export async function computeScheduleExceptionImpact(params: {
  clubId: string
  startAt: Date
  endAt: Date
}) {
  const slots = await prisma.slot.findMany({
    where: {
      clubId: params.clubId,
      startAtUtc: { lt: params.endAt },
      endAtUtc: { gt: params.startAt },
    },
    select: { id: true },
  })
  if (slots.length === 0) {
    return {
      impactedSlots: 0,
      impactedBookings: 0,
      impactedActiveBookings: 0,
    }
  }

  const bookings = await prisma.booking.findMany({
    where: {
      clubId: params.clubId,
      slotId: { in: slots.map((slot) => slot.id) },
    },
    select: { id: true, status: true },
  })

  const activeStatuses = new Set<BookingStatus>(activeBookingStatuses())
  const impactedActiveBookings = bookings.filter((booking) => activeStatuses.has(booking.status)).length

  return {
    impactedSlots: slots.length,
    impactedBookings: bookings.length,
    impactedActiveBookings,
  }
}

export async function createSchedulePlanDraft(params: {
  clubId: string
  userId: string
  templateId?: string | null
  rangeStart?: string | null
  rangeEnd?: string | null
  horizonDays?: number | null
  options?: unknown
}) {
  const club = await prisma.club.findUnique({
    where: { id: params.clubId },
    select: { id: true, timezone: true },
  })
  if (!club) {
    throw new Error('Club was not found.')
  }

  const template = await prisma.scheduleTemplate.findFirst({
    where: {
      clubId: params.clubId,
      ...(params.templateId ? { id: params.templateId } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      defaultHorizonDays: true,
      slotDurationMinutes: true,
      slotStepMinutes: true,
      breakBufferMinutes: true,
      weeklyHoursJson: true,
      revision: true,
      effectiveFrom: true,
    },
  })
  if (!template) {
    throw new Error('Schedule template is not configured.')
  }
  if (
    template.status !== ScheduleTemplateStatus.ACTIVE &&
    template.status !== ScheduleTemplateStatus.DRAFT
  ) {
    throw new Error('Schedule template is archived.')
  }

  const weeklyHours = parseWeeklyHoursJson(template.weeklyHoursJson)
  if (!weeklyHours) {
    throw new Error('Stored schedule template is corrupted.')
  }

  const now = new Date()
  const baseFrom = localDateNow(club.timezone, now)
  const effectiveFromLocalDate = template.effectiveFrom
    ? localDateNow(club.timezone, template.effectiveFrom)
    : null
  const defaultFrom =
    effectiveFromLocalDate && effectiveFromLocalDate > baseFrom ? effectiveFromLocalDate : baseFrom

  const requestedFrom = params.rangeStart ? parseDateOnly(params.rangeStart) : null
  const requestedTo = params.rangeEnd ? parseDateOnly(params.rangeEnd) : null
  if (params.rangeStart && !requestedFrom) {
    throw new Error('rangeStart must be in YYYY-MM-DD format.')
  }
  if (params.rangeEnd && !requestedTo) {
    throw new Error('rangeEnd must be in YYYY-MM-DD format.')
  }

  const fromLocalDate = requestedFrom ?? defaultFrom
  const horizonDays =
    params.horizonDays && Number.isInteger(params.horizonDays)
      ? Math.min(Math.max(params.horizonDays, 1), 180)
      : template.defaultHorizonDays
  const toLocalDate = requestedTo ?? addDaysLocalDate(fromLocalDate, horizonDays) ?? fromLocalDate
  if (toLocalDate < fromLocalDate) {
    throw new Error('rangeEnd must be greater than or equal to rangeStart.')
  }

  const rangeStartUtc = startOfLocalDateUtc(fromLocalDate, club.timezone) ?? now
  const nextDate = addDaysLocalDate(toLocalDate, 1) ?? toLocalDate
  const rangeEndUtc =
    startOfLocalDateUtc(nextDate, club.timezone) ??
    new Date(rangeStartUtc.getTime() + 24 * 60 * 60 * 1000)

  const exceptions = await prisma.scheduleException.findMany({
    where: {
      clubId: params.clubId,
      deletedAt: null,
      startAt: { lt: rangeEndUtc },
      endAt: { gt: rangeStartUtc },
    },
    select: { type: true, startAt: true, endAt: true },
  })
  const overlappingExceptionConflicts: PlanConflict[] = []
  const sortedExceptions = [...exceptions].sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
  for (let index = 1; index < sortedExceptions.length; index += 1) {
    const previous = sortedExceptions[index - 1]
    const current = sortedExceptions[index]
    if (current.startAt >= previous.endAt) continue
    overlappingExceptionConflicts.push({
      code: 'SCOPE_COLLISION',
      slotId: `scope-collision:${index}`,
      startAtUtc: current.startAt.toISOString(),
      endAtUtc: current.endAt.toISOString(),
      bookingCount: 0,
      severity: 'warning',
      message: 'Multiple schedule exceptions overlap in the same date window.',
      suggestedActions: ['review overlapping exceptions', 'merge duplicate exception windows'],
    })
  }

  const generated = generateSlots({
    timeZone: club.timezone,
    fromLocalDate,
    toLocalDate,
    slotDurationMinutes: template.slotDurationMinutes,
    slotStepMinutes: template.slotStepMinutes,
    breakBufferMinutes: template.breakBufferMinutes,
    weeklyHours,
    exceptions,
    now,
  })

  const generatedByKey = new Map<string, (typeof generated)[number]>()
  for (const slot of generated) {
    generatedByKey.set(utcMinuteKey(slot.startAtUtc, slot.endAtUtc), slot)
  }

  const existingSlots = await prisma.slot.findMany({
    where: {
      clubId: params.clubId,
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
  const activeBookings = existingSlots.length
    ? await prisma.booking.groupBy({
        by: ['slotId'],
        where: {
          clubId: params.clubId,
          slotId: { in: existingSlots.map((slot) => slot.id) },
          status: { in: activeBookingStatuses() },
        },
        _count: { slotId: true },
      })
    : []
  const activeBookingBySlotId = new Map<string, number>()
  for (const row of activeBookings) {
    if (row.slotId) activeBookingBySlotId.set(row.slotId, row._count.slotId)
  }

  const planSlotByKey = new Map<string, SlotSnapshot>()
  let created = 0
  let updated = 0
  let removed = 0
  let blocked = 0
  let locked = 0
  let changed = 0
  let touchWindowProtectedSlots = 0
  const conflicts: PlanConflict[] = []
  const options = parseCreatePlanOptions(params.options)
  const touchWindowThreshold = new Date(now.getTime() + options.touchWindowMinutes * 60_000)

  for (const generatedSlot of generated) {
    const key = utcMinuteKey(generatedSlot.startAtUtc, generatedSlot.endAtUtc)
    const existing = existingByKey.get(key)
    const existingBooked = existing ? activeBookingBySlotId.get(existing.id) ?? 0 : 0

    let nextStatus: SlotStatus =
      generatedSlot.status === SlotStatus.PUBLISHED
        ? SlotStatus.PUBLISHED
        : existingBooked > 0
          ? SlotStatus.CANCELLED_LOCKED
          : SlotStatus.BLOCKED

    const isTouchWindowProtected = generatedSlot.startAtUtc < touchWindowThreshold
    if (isTouchWindowProtected && existing) {
      nextStatus = existing.status
      touchWindowProtectedSlots += 1
    }

    if (existing) {
      if (existing.status !== nextStatus || existing.localDate !== generatedSlot.localDate) {
        updated += 1
        changed += 1
      }
      if (existingBooked > 0 && nextStatus !== SlotStatus.PUBLISHED) {
        conflicts.push({
          code: 'BOOKING_IN_CLOSED_SLOT',
          slotId: existing.id,
          startAtUtc: existing.startAtUtc.toISOString(),
          endAtUtc: existing.endAtUtc.toISOString(),
          bookingCount: existingBooked,
          severity: options.publishMode === 'FORCE' ? 'warning' : 'blocker',
          message: 'Schedule closes a slot that has active bookings.',
          suggestedActions: [
            'keep slot frozen',
            'create exception to keep window open',
            'reschedule bookings manually',
          ],
        })
      }
    } else {
      created += 1
    }

    if (nextStatus === SlotStatus.BLOCKED) blocked += 1
    if (nextStatus === SlotStatus.CANCELLED_LOCKED) locked += 1

    planSlotByKey.set(
      key,
      serializeSnapshot({
        startAtUtc: generatedSlot.startAtUtc,
        endAtUtc: generatedSlot.endAtUtc,
        localDate: generatedSlot.localDate,
        status: nextStatus,
      }),
    )
  }

  for (const existing of existingSlots) {
    const key = utcMinuteKey(existing.startAtUtc, existing.endAtUtc)
    if (generatedByKey.has(key)) continue

    removed += 1
    const existingBooked = activeBookingBySlotId.get(existing.id) ?? 0
    let nextStatus: SlotStatus = existingBooked > 0 ? SlotStatus.CANCELLED_LOCKED : SlotStatus.BLOCKED
    if (existing.startAtUtc < touchWindowThreshold) {
      nextStatus = existing.status
      touchWindowProtectedSlots += 1
    }
    if (nextStatus === SlotStatus.BLOCKED) blocked += 1
    if (nextStatus === SlotStatus.CANCELLED_LOCKED) locked += 1

    if (existingBooked > 0) {
      conflicts.push({
        code: 'BOOKING_IN_REMOVED_SLOT',
        slotId: existing.id,
        startAtUtc: existing.startAtUtc.toISOString(),
        endAtUtc: existing.endAtUtc.toISOString(),
        bookingCount: existingBooked,
        severity: options.publishMode === 'FORCE' ? 'warning' : 'blocker',
        message: 'Schedule removes a slot that has active bookings.',
        suggestedActions: [
          'keep slot frozen',
          'create open-extra exception',
          'reschedule bookings manually',
        ],
      })
    }

    planSlotByKey.set(
      key,
      serializeSnapshot({
        startAtUtc: existing.startAtUtc,
        endAtUtc: existing.endAtUtc,
        localDate: existing.localDate,
        status: nextStatus,
      }),
    )
  }

  const signature = templateSignature({
    templateId: template.id,
    revision: template.revision,
    slotDurationMinutes: template.slotDurationMinutes,
    weeklyHours,
  })

  const slots = Array.from(planSlotByKey.values()).sort(sortSnapshots)
  conflicts.push(...overlappingExceptionConflicts)
  const conflictSummary = summarizeConflicts(conflicts)
  const diffSummary: PlanDiffSummary = {
    fromLocalDate,
    toLocalDate,
    totalGeneratedSlots: generated.length,
    finalSlotCount: slots.length,
    created,
    updated,
    removed,
    blocked,
    locked,
    changed,
    closed: blocked + locked,
    touchWindowMinutes: options.touchWindowMinutes,
    bookingConflicts: conflicts.length,
    warningConflicts: conflictSummary.warnings,
    blockerConflicts: conflictSummary.blockers,
    touchWindowProtectedSlots,
    publishMode: options.publishMode,
    bookedSlotsPolicy: options.bookedSlotsPolicy,
  }

  const plan = await prisma.schedulePlan.create({
    data: {
      clubId: params.clubId,
      templateId: template.id,
      status: SchedulePlanStatus.DRAFT_GENERATED,
      fromLocalDate,
      toLocalDate,
      rangeStartUtc,
      rangeEndUtc,
      diffSummaryJson: JSON.stringify(diffSummary),
      conflictsJson: JSON.stringify(conflicts),
      slotsJson: JSON.stringify(slots),
      generatedByUserId: params.userId,
    },
    select: {
      id: true,
      clubId: true,
      templateId: true,
      status: true,
      fromLocalDate: true,
      toLocalDate: true,
      rangeStartUtc: true,
      rangeEndUtc: true,
      generatedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.userId,
      action: 'schedule.plan_generated',
      entityType: 'schedule_plan',
      entityId: plan.id,
      metadata: JSON.stringify({
        templateId: template.id,
        templateName: template.name,
        signature,
        options,
        ...diffSummary,
      }),
    },
  })

  if (conflicts.length > 0) {
    await prisma.auditLog.create({
      data: {
        clubId: params.clubId,
        actorUserId: params.userId,
        action: 'schedule.conflict.detected',
        entityType: 'schedule_plan',
        entityId: plan.id,
        metadata: JSON.stringify({
          conflictSummary,
          firstConflicts: conflicts.slice(0, 20),
        }),
      },
    })
  }

  return {
    plan,
    diffSummary,
    conflicts,
    conflictSummary,
  }
}

export async function getSchedulePlanSnapshot(planId: string, clubId: string) {
  const plan = await prisma.schedulePlan.findFirst({
    where: { id: planId, clubId },
    select: {
      id: true,
      clubId: true,
      templateId: true,
      status: true,
      fromLocalDate: true,
      toLocalDate: true,
      rangeStartUtc: true,
      rangeEndUtc: true,
      generatedAt: true,
      publishedAt: true,
      diffSummaryJson: true,
      conflictsJson: true,
      slotsJson: true,
    },
  })
  if (!plan) return null
  return {
    id: plan.id,
    clubId: plan.clubId,
    templateId: plan.templateId,
    status: plan.status,
    fromLocalDate: plan.fromLocalDate,
    toLocalDate: plan.toLocalDate,
    rangeStartUtc: plan.rangeStartUtc,
    rangeEndUtc: plan.rangeEndUtc,
    generatedAt: plan.generatedAt,
    publishedAt: plan.publishedAt,
    diffSummary: parseDiffSummary(plan.diffSummaryJson),
    conflicts: parseConflicts(plan.conflictsJson),
    conflictSummary: summarizeConflicts(parseConflicts(plan.conflictsJson)),
    slots: parseSnapshots(plan.slotsJson),
  }
}

export async function publishSchedulePlan(params: {
  planId: string
  clubId: string
  userId: string
  effectiveFrom?: Date | null
  touchWindowMinutes?: number
  publishMode?: 'SAFE' | 'FORCE'
  reason?: string | null
}) {
  const snapshot = await getSchedulePlanSnapshot(params.planId, params.clubId)
  if (!snapshot) {
    throw new Error('Schedule plan was not found.')
  }
  if (snapshot.status === SchedulePlanStatus.PUBLISHED) {
    return {
      alreadyPublished: true,
      schedulePublishedAt: snapshot.publishedAt ?? new Date(),
      slotsGeneratedUntil: snapshot.rangeEndUtc,
      result: {
        created: 0,
        updated: 0,
        blocked: 0,
        locked: 0,
        removed: 0,
      },
      diffSummary: snapshot.diffSummary,
      conflicts: snapshot.conflicts,
      conflictSummary: snapshot.conflictSummary,
    }
  }
  if (snapshot.status !== SchedulePlanStatus.DRAFT_GENERATED) {
    throw new Error('Only draft generated plans can be published.')
  }

  const desiredByKey = new Map<string, SlotSnapshot>()
  for (const item of snapshot.slots) {
    const key = utcMinuteKey(new Date(item.startAtUtc), new Date(item.endAtUtc))
    desiredByKey.set(key, item)
  }

  const existingSlots = await prisma.slot.findMany({
    where: {
      clubId: snapshot.clubId,
      startAtUtc: { gte: snapshot.rangeStartUtc, lt: snapshot.rangeEndUtc },
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
  const activeBookingRows = existingSlotIds.length
    ? await prisma.booking.findMany({
        where: {
          clubId: snapshot.clubId,
          slotId: { in: existingSlotIds },
          status: { in: activeBookingStatuses() },
        },
        select: { slotId: true },
      })
    : []
  const activeBookedSlotIds = new Set(
    activeBookingRows
      .map((row) => row.slotId)
      .filter((value): value is string => Boolean(value)),
  )

  let created = 0
  let updated = 0
  let blocked = 0
  let locked = 0
  let removed = 0
  const touchWindowMinutes = Number.isInteger(params.touchWindowMinutes)
    ? Math.min(Math.max(params.touchWindowMinutes ?? 0, 0), 1440)
    : 240
  const touchWindowThreshold = new Date(Date.now() + touchWindowMinutes * 60_000)
  const effectiveFrom = params.effectiveFrom ?? null
  const publishMode = params.publishMode === 'FORCE' ? 'FORCE' : 'SAFE'

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    for (const [key, desired] of desiredByKey.entries()) {
      const existing = existingByKey.get(key)
      const desiredStart = new Date(desired.startAtUtc)
      const isBeforeEffectiveFrom = effectiveFrom ? desiredStart < effectiveFrom : false
      const isTouchWindowProtected = desiredStart < touchWindowThreshold
      if (isBeforeEffectiveFrom || isTouchWindowProtected) {
        continue
      }
      if (!existing) {
        await tx.slot.create({
          data: {
            clubId: snapshot.clubId,
            startAtUtc: desiredStart,
            endAtUtc: new Date(desired.endAtUtc),
            localDate: desired.localDate,
            status: desired.status,
            generatedFrom: snapshot.id,
          },
        })
        created += 1
      } else if (existing.status !== desired.status || existing.localDate !== desired.localDate) {
        await tx.slot.update({
          where: { id: existing.id },
          data: {
            status: desired.status,
            localDate: desired.localDate,
            generatedFrom: snapshot.id,
          },
        })
        updated += 1
      }

      if (desired.status === SlotStatus.BLOCKED) blocked += 1
      if (desired.status === SlotStatus.CANCELLED_LOCKED) locked += 1
    }

    for (const [key, existing] of existingByKey.entries()) {
      if (desiredByKey.has(key)) continue
      if ((effectiveFrom && existing.startAtUtc < effectiveFrom) || existing.startAtUtc < touchWindowThreshold) {
        continue
      }
      if (activeBookedSlotIds.has(existing.id) && publishMode !== 'FORCE') {
        continue
      }
      const nextStatus = SlotStatus.BLOCKED
      if (existing.status !== nextStatus) {
        await tx.slot.update({
          where: { id: existing.id },
          data: {
            status: nextStatus,
            generatedFrom: snapshot.id,
          },
        })
        updated += 1
      }
      blocked += 1
      removed += 1
    }

    await tx.schedulePlan.updateMany({
      where: {
        clubId: snapshot.clubId,
        status: SchedulePlanStatus.PUBLISHED,
        id: { not: snapshot.id },
      },
      data: {
        status: SchedulePlanStatus.SUPERSEDED,
      },
    })

    await tx.schedulePlan.update({
      where: { id: snapshot.id },
      data: {
        status: SchedulePlanStatus.PUBLISHED,
        publishedAt: now,
        publishedByUserId: params.userId,
      },
    })

    await tx.club.update({
      where: { id: snapshot.clubId },
      data: {
        schedulePublishedAt: now,
        slotsGeneratedUntil: snapshot.rangeEndUtc,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: snapshot.clubId,
        actorUserId: params.userId,
        action: 'schedule.plan_published',
        entityType: 'schedule_plan',
        entityId: snapshot.id,
      metadata: JSON.stringify({
          fromLocalDate: snapshot.fromLocalDate,
          toLocalDate: snapshot.toLocalDate,
          effectiveFrom: effectiveFrom?.toISOString() ?? null,
          touchWindowMinutes,
          publishMode,
          reason: params.reason ?? null,
          created,
          updated,
          blocked,
          locked,
          removed,
        }),
      },
    })
  })

  invalidateAvailabilityCacheForClub(snapshot.clubId)

  return {
    alreadyPublished: false,
    schedulePublishedAt: now,
    slotsGeneratedUntil: snapshot.rangeEndUtc,
    result: {
      created,
      updated,
      blocked,
      locked,
      removed,
    },
    diffSummary: snapshot.diffSummary,
    conflicts: snapshot.conflicts,
    conflictSummary: snapshot.conflictSummary,
  }
}
