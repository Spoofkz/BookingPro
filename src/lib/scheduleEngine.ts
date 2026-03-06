import { createHash } from 'node:crypto'
import { ScheduleExceptionType, SlotStatus } from '@prisma/client'

export const DEFAULT_SLOT_DURATION_MINUTES = 60
export const DEFAULT_BOOKING_LEAD_TIME_MINUTES = 0
export const DEFAULT_MAX_ADVANCE_DAYS = 30
export const DEFAULT_PUBLISH_HORIZON_DAYS = 30

export const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

export type WeeklyDayConfig = {
  closed: boolean
  openTime: string | null
  closeTime: string | null
}

export type WeeklyHours = Record<WeekdayKey, WeeklyDayConfig>

export type NormalizedScheduleTemplate = {
  name: string
  defaultHorizonDays: number
  slotDurationMinutes: number
  slotStepMinutes: number
  breakBufferMinutes: number
  fixedStartsOnly: boolean
  bookingLeadTimeMinutes: number
  maxAdvanceDays: number
  weeklyHours: WeeklyHours
  effectiveFrom: Date | null
}

export type ScheduleExceptionInput = {
  type: ScheduleExceptionType
  startAt: Date
  endAt: Date
}

export type GeneratedSlot = {
  startAtUtc: Date
  endAtUtc: Date
  localDate: string
  status: SlotStatus
}

type DateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterForTimeZone(timeZone: string) {
  const cached = timeFormatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  timeFormatterCache.set(timeZone, formatter)
  return formatter
}

function utcDateFromDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map((part) => Number(part))
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10)
}

function dateOnlyWithOffset(value: string, offsetDays: number) {
  const date = utcDateFromDateOnly(value)
  if (!date) return null
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return formatDateOnly(date)
}

function parseDateParts(date: Date, timeZone: string): DateParts {
  const formatter = formatterForTimeZone(timeZone)
  const parts = formatter.formatToParts(date)
  const values: Record<string, number> = {}
  for (const part of parts) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      values[part.type] = Number(part.value)
    }
  }
  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

function datePartsToEpochMinutes(parts: DateParts) {
  return Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) / 60000,
  )
}

function parseTimeStringToMinutes(value: string) {
  const normalized = value.trim()
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(normalized)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour * 60 + minute
}

function overlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB
}

function localDateFromDate(date: Date, timeZone: string) {
  const parts = parseDateParts(date, timeZone)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

function localDateTimeToUtc(localDate: string, minutesOfDay: number, timeZone: string) {
  const dateOnly = utcDateFromDateOnly(localDate)
  if (!dateOnly) return null
  const hour = Math.floor(minutesOfDay / 60)
  const minute = minutesOfDay % 60
  const desired: DateParts = {
    year: dateOnly.getUTCFullYear(),
    month: dateOnly.getUTCMonth() + 1,
    day: dateOnly.getUTCDate(),
    hour,
    minute,
    second: 0,
  }

  let utcMs = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  )

  for (let index = 0; index < 5; index += 1) {
    const actual = parseDateParts(new Date(utcMs), timeZone)
    const diffMinutes = datePartsToEpochMinutes(desired) - datePartsToEpochMinutes(actual)
    if (diffMinutes === 0) return new Date(utcMs)
    utcMs += diffMinutes * 60_000
  }

  return new Date(utcMs)
}

function minuteValue(date: Date) {
  return Math.floor(date.getTime() / 60_000)
}

function expandClosedAllDayDates(
  exceptions: ScheduleExceptionInput[],
  timeZone: string,
) {
  const closedDates = new Set<string>()
  for (const exception of exceptions) {
    if (exception.type !== ScheduleExceptionType.CLOSED_ALL_DAY) continue
    const startDate = localDateFromDate(exception.startAt, timeZone)
    const endDate = localDateFromDate(new Date(exception.endAt.getTime() - 1), timeZone)
    const range: string[] = []
    let cursor = startDate
    while (cursor <= endDate) {
      range.push(cursor)
      const next = dateOnlyWithOffset(cursor, 1)
      if (!next) break
      cursor = next
    }
    for (const date of range) closedDates.add(date)
  }
  return closedDates
}

function specialHoursByDate(
  exceptions: ScheduleExceptionInput[],
  timeZone: string,
) {
  const byDate = new Map<string, Array<{ startAt: Date; endAt: Date }>>()
  for (const exception of exceptions) {
    if (exception.type !== ScheduleExceptionType.SPECIAL_HOURS) continue
    const localDate = localDateFromDate(exception.startAt, timeZone)
    const current = byDate.get(localDate) ?? []
    current.push({ startAt: exception.startAt, endAt: exception.endAt })
    byDate.set(localDate, current)
  }
  return byDate
}

function blockedRangeExceptions(exceptions: ScheduleExceptionInput[]) {
  return exceptions.filter(
    (exception) =>
      exception.type === ScheduleExceptionType.CLOSED_RANGE ||
      exception.type === ScheduleExceptionType.BLOCKED_RANGE,
  )
}

export function isValidIanaTimeZone(value: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function defaultWeeklyHours(): WeeklyHours {
  return {
    sunday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    monday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    tuesday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    wednesday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    thursday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    friday: { closed: false, openTime: '10:00', closeTime: '22:00' },
    saturday: { closed: false, openTime: '10:00', closeTime: '22:00' },
  }
}

export function parseWeeklyHoursJson(value: string | null | undefined): WeeklyHours | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    const normalized = normalizeWeeklyHours(parsed)
    return normalized.value
  } catch {
    return null
  }
}

export function serializeWeeklyHours(value: WeeklyHours) {
  return JSON.stringify(value)
}

export function normalizeWeeklyHours(value: unknown): {
  value: WeeklyHours | null
  errors: string[]
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value: null, errors: ['weeklyHours must be an object keyed by weekdays.'] }
  }

  const record = value as Record<string, unknown>
  const normalized: Partial<WeeklyHours> = {}
  const errors: string[] = []

  for (const key of WEEKDAY_KEYS) {
    const dayInput = record[key]
    if (!dayInput || typeof dayInput !== 'object' || Array.isArray(dayInput)) {
      errors.push(`weeklyHours.${key} must be an object.`)
      continue
    }
    const dayRecord = dayInput as Record<string, unknown>
    const closed = dayRecord.closed === true
    const openTimeRaw = typeof dayRecord.openTime === 'string' ? dayRecord.openTime.trim() : ''
    const closeTimeRaw = typeof dayRecord.closeTime === 'string' ? dayRecord.closeTime.trim() : ''

    if (closed) {
      normalized[key] = { closed: true, openTime: null, closeTime: null }
      continue
    }

    const openMinutes = parseTimeStringToMinutes(openTimeRaw)
    const closeMinutes = parseTimeStringToMinutes(closeTimeRaw)
    if (openMinutes == null) {
      errors.push(`weeklyHours.${key}.openTime must be HH:mm.`)
      continue
    }
    if (closeMinutes == null) {
      errors.push(`weeklyHours.${key}.closeTime must be HH:mm.`)
      continue
    }
    if (openMinutes === closeMinutes) {
      errors.push(`weeklyHours.${key} openTime and closeTime cannot be equal.`)
      continue
    }

    normalized[key] = { closed: false, openTime: openTimeRaw, closeTime: closeTimeRaw }
  }

  if (errors.length > 0) return { value: null, errors }
  return { value: normalized as WeeklyHours, errors: [] }
}

export function normalizeScheduleTemplateInput(input: unknown): {
  value: NormalizedScheduleTemplate | null
  errors: string[]
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: ['Template payload must be an object.'] }
  }
  const record = input as Record<string, unknown>

  const slotDurationMinutes = Number(record.slotDurationMinutes)
  const slotStepMinutes =
    record.slotStepMinutes === undefined ? slotDurationMinutes : Number(record.slotStepMinutes)
  const breakBufferMinutes =
    record.breakBufferMinutes === undefined ? 0 : Number(record.breakBufferMinutes)
  const bookingLeadTimeMinutes = Number(record.bookingLeadTimeMinutes)
  const maxAdvanceDays = Number(record.maxAdvanceDays)
  const defaultHorizonDays =
    record.defaultHorizonDays === undefined ? maxAdvanceDays : Number(record.defaultHorizonDays)
  const fixedStartsOnly = record.fixedStartsOnly === true
  const nameRaw = typeof record.name === 'string' ? record.name.trim() : ''
  const name = nameRaw.length > 0 ? nameRaw : 'Default schedule'

  const errors: string[] = []
  if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes < 15 || slotDurationMinutes > 720) {
    errors.push('slotDurationMinutes must be an integer between 15 and 720.')
  }
  if (!Number.isInteger(slotStepMinutes) || slotStepMinutes < 5 || slotStepMinutes > 720) {
    errors.push('slotStepMinutes must be an integer between 5 and 720.')
  }
  if (!Number.isInteger(breakBufferMinutes) || breakBufferMinutes < 0 || breakBufferMinutes > 180) {
    errors.push('breakBufferMinutes must be an integer between 0 and 180.')
  }
  if (
    !Number.isInteger(bookingLeadTimeMinutes) ||
    bookingLeadTimeMinutes < 0 ||
    bookingLeadTimeMinutes > 10_080
  ) {
    errors.push('bookingLeadTimeMinutes must be an integer between 0 and 10080.')
  }
  if (!Number.isInteger(maxAdvanceDays) || maxAdvanceDays < 1 || maxAdvanceDays > 120) {
    errors.push('maxAdvanceDays must be an integer between 1 and 120.')
  }
  if (!Number.isInteger(defaultHorizonDays) || defaultHorizonDays < 1 || defaultHorizonDays > 180) {
    errors.push('defaultHorizonDays must be an integer between 1 and 180.')
  }
  if (
    Number.isInteger(slotDurationMinutes) &&
    Number.isInteger(breakBufferMinutes) &&
    slotDurationMinutes + breakBufferMinutes > 1440
  ) {
    errors.push('slotDurationMinutes + breakBufferMinutes cannot exceed 1440.')
  }

  const weeklyHoursResult = normalizeWeeklyHours(record.weeklyHours)
  errors.push(...weeklyHoursResult.errors)

  const effectiveFromRaw =
    typeof record.effectiveFrom === 'string' && record.effectiveFrom.trim().length > 0
      ? new Date(record.effectiveFrom)
      : null
  if (effectiveFromRaw && Number.isNaN(effectiveFromRaw.getTime())) {
    errors.push('effectiveFrom must be an ISO datetime when provided.')
  }

  if (errors.length > 0 || !weeklyHoursResult.value) {
    return { value: null, errors }
  }

  return {
    value: {
      name,
      defaultHorizonDays,
      slotDurationMinutes,
      slotStepMinutes,
      breakBufferMinutes,
      fixedStartsOnly,
      bookingLeadTimeMinutes,
      maxAdvanceDays,
      weeklyHours: weeklyHoursResult.value,
      effectiveFrom: effectiveFromRaw,
    },
    errors: [],
  }
}

export function normalizeExceptionInput(input: unknown): {
  value: ScheduleExceptionInput | null
  errors: string[]
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: ['Exception payload must be an object.'] }
  }
  const record = input as Record<string, unknown>
  const typeRaw = typeof record.type === 'string' ? record.type : ''
  const type = Object.values(ScheduleExceptionType).find((item) => item === typeRaw)
  const startAt = typeof record.startAt === 'string' ? new Date(record.startAt) : null
  const endAt = typeof record.endAt === 'string' ? new Date(record.endAt) : null

  const errors: string[] = []
  if (!type) errors.push('type is invalid.')
  if (!startAt || Number.isNaN(startAt.getTime())) errors.push('startAt must be a valid ISO datetime.')
  if (!endAt || Number.isNaN(endAt.getTime())) errors.push('endAt must be a valid ISO datetime.')
  if (startAt && endAt && startAt >= endAt) {
    errors.push('endAt must be greater than startAt.')
  }

  if (errors.length > 0 || !type || !startAt || !endAt) {
    return { value: null, errors }
  }

  return {
    value: {
      type,
      startAt,
      endAt,
    },
    errors: [],
  }
}

export function localDateNow(timeZone: string, now = new Date()) {
  return localDateFromDate(now, timeZone)
}

export function addDaysLocalDate(localDate: string, days: number) {
  return dateOnlyWithOffset(localDate, days)
}

export function startOfLocalDateUtc(localDate: string, timeZone: string) {
  return localDateTimeToUtc(localDate, 0, timeZone)
}

export function horizonRange(
  timeZone: string,
  horizonDays: number,
  now = new Date(),
): {
  fromLocalDate: string
  toLocalDate: string
  rangeStartUtc: Date
  rangeEndUtc: Date
  slotsGeneratedUntil: Date
} {
  const fromLocalDate = localDateNow(timeZone, now)
  const toLocalDate = addDaysLocalDate(fromLocalDate, horizonDays) ?? fromLocalDate
  const rangeStartUtc = startOfLocalDateUtc(fromLocalDate, timeZone) ?? now
  const nextDate = addDaysLocalDate(toLocalDate, 1) ?? toLocalDate
  const rangeEndUtc = startOfLocalDateUtc(nextDate, timeZone) ?? new Date(now.getTime() + 86_400_000)
  return {
    fromLocalDate,
    toLocalDate,
    rangeStartUtc,
    rangeEndUtc,
    slotsGeneratedUntil: rangeEndUtc,
  }
}

export function templateSignature(params: {
  templateId: string
  revision: number
  slotDurationMinutes: number
  weeklyHours: WeeklyHours
}) {
  const payload = JSON.stringify({
    templateId: params.templateId,
    revision: params.revision,
    slotDurationMinutes: params.slotDurationMinutes,
    weeklyHours: params.weeklyHours,
  })
  const hash = createHash('sha1').update(payload).digest('hex').slice(0, 12)
  return `${params.templateId}:${params.revision}:${hash}`
}

export function generateSlots(params: {
  timeZone: string
  fromLocalDate: string
  toLocalDate: string
  slotDurationMinutes: number
  slotStepMinutes?: number
  breakBufferMinutes?: number
  weeklyHours: WeeklyHours
  exceptions: ScheduleExceptionInput[]
  now?: Date
}): GeneratedSlot[] {
  const generated: GeneratedSlot[] = []
  const now = params.now ?? new Date()
  const slotDurationMs = params.slotDurationMinutes * 60_000
  const slotStepMinutes = params.slotStepMinutes ?? params.slotDurationMinutes
  const breakBufferMinutes = params.breakBufferMinutes ?? 0
  const requiredWindowMs = (params.slotDurationMinutes + breakBufferMinutes) * 60_000
  const slotStepMs = Math.max(1, slotStepMinutes) * 60_000
  const seenKeys = new Set<string>()
  const closedAllDayDates = expandClosedAllDayDates(params.exceptions, params.timeZone)
  const specialByDate = specialHoursByDate(params.exceptions, params.timeZone)
  const blockedExceptions = blockedRangeExceptions(params.exceptions)
  const localNow = localDateNow(params.timeZone, now)

  let cursor = params.fromLocalDate
  while (cursor <= params.toLocalDate) {
    const weekday = WEEKDAY_KEYS[new Date(`${cursor}T00:00:00.000Z`).getUTCDay()]
    const dayConfig = params.weeklyHours[weekday]
    const specialRanges = specialByDate.get(cursor) ?? []

    const windows: Array<{ startAt: Date; endAt: Date }> = []

    if (!closedAllDayDates.has(cursor)) {
      if (specialRanges.length > 0) {
        windows.push(...specialRanges)
      } else if (!dayConfig.closed && dayConfig.openTime && dayConfig.closeTime) {
        const openMinutes = parseTimeStringToMinutes(dayConfig.openTime)
        const closeMinutes = parseTimeStringToMinutes(dayConfig.closeTime)
        if (openMinutes != null && closeMinutes != null) {
          const startAt = localDateTimeToUtc(cursor, openMinutes, params.timeZone)
          const overnight = closeMinutes < openMinutes
          const closeDate = overnight ? addDaysLocalDate(cursor, 1) : cursor
          const endAt = closeDate
            ? localDateTimeToUtc(closeDate, closeMinutes, params.timeZone)
            : null
          if (startAt && endAt && startAt < endAt) {
            windows.push({ startAt, endAt })
          }
        }
      }
    }

    for (const window of windows) {
      let slotStartMs = window.startAt.getTime()
      const windowEndMs = window.endAt.getTime()
      while (slotStartMs + requiredWindowMs <= windowEndMs) {
        const slotStart = new Date(slotStartMs)
        const slotEnd = new Date(slotStartMs + slotDurationMs)
        if (slotEnd <= now) {
          slotStartMs += slotStepMs
          continue
        }

        const slotLocalDate = localDateFromDate(slotStart, params.timeZone)
        let status: SlotStatus = SlotStatus.PUBLISHED

        if (closedAllDayDates.has(slotLocalDate)) {
          status = SlotStatus.BLOCKED
        }

        if (status === SlotStatus.PUBLISHED) {
          for (const exception of blockedExceptions) {
            if (overlap(slotStart, slotEnd, exception.startAt, exception.endAt)) {
              status = SlotStatus.BLOCKED
              break
            }
          }
        }

        if (status === SlotStatus.PUBLISHED && slotLocalDate < localNow) {
          status = SlotStatus.BLOCKED
        }

        const key = utcMinuteKey(slotStart, slotEnd)
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          generated.push({
            startAtUtc: slotStart,
            endAtUtc: slotEnd,
            localDate: slotLocalDate,
            status,
          })
        }

        slotStartMs += slotStepMs
      }
    }

    const nextDate = addDaysLocalDate(cursor, 1)
    if (!nextDate) break
    cursor = nextDate
  }

  generated.sort((left, right) => left.startAtUtc.getTime() - right.startAtUtc.getTime())
  return generated
}

export function hasOverlapWithExistingException(
  existing: Array<{ id: string; startAt: Date; endAt: Date }>,
  candidate: { startAt: Date; endAt: Date },
) {
  return existing.find((item) => overlap(item.startAt, item.endAt, candidate.startAt, candidate.endAt)) ?? null
}

export function isSpecialHoursSingleDate(exception: ScheduleExceptionInput, timeZone: string) {
  if (exception.type !== ScheduleExceptionType.SPECIAL_HOURS) return true
  return localDateFromDate(exception.startAt, timeZone) === localDateFromDate(exception.endAt, timeZone)
}

export function utcMinuteKey(startAtUtc: Date, endAtUtc: Date) {
  return `${minuteValue(startAtUtc)}:${minuteValue(endAtUtc)}`
}
