type PolicyRecord = Record<string, unknown>

export type CancellationPolicy = {
  cutoffMinutes: number
}

export type CheckInPolicy = {
  openBeforeMinutes: number
  closeAfterMinutes: number
}

export type ReschedulePolicy = {
  rescheduleEnabled: boolean
  rescheduleCutoffMinutesBeforeStart: number
  maxReschedulesPerBooking: number
  allowRescheduleAfterStart: boolean
  rescheduleHoldTtlMinutes: number
  allowClientNegativeDelta: boolean
}

const DEFAULT_CANCELLATION_CUTOFF_MINUTES = 0
const DEFAULT_CHECKIN_OPEN_BEFORE_MINUTES = 15
const DEFAULT_CHECKIN_CLOSE_AFTER_MINUTES = 30
const DEFAULT_RESCHEDULE_ENABLED = true
const DEFAULT_RESCHEDULE_CUTOFF_MINUTES = 60
const DEFAULT_RESCHEDULE_MAX_PER_BOOKING = 2
const DEFAULT_RESCHEDULE_ALLOW_AFTER_START = false
const DEFAULT_RESCHEDULE_HOLD_TTL_MINUTES = 10
const DEFAULT_RESCHEDULE_ALLOW_CLIENT_NEGATIVE_DELTA = false

function asRecord(value: unknown): PolicyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as PolicyRecord
}

function parseInteger(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.trim())
        : NaN
  if (!Number.isInteger(numeric)) return null
  return numeric
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (['true', '1', 'yes', 'enabled', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'disabled', 'off'].includes(normalized)) return false
  return null
}

function normalizePriceDeltaHandling(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return normalized || null
}

function allowsNegativeDelta(mode: string) {
  return (
    mode === 'BOTH' ||
    mode === 'ALLOW_BOTH' ||
    mode === 'ALLOW_NEGATIVE' ||
    mode === 'NEGATIVE_ALLOWED' ||
    mode === 'DELTA_ANY' ||
    mode === 'ANY'
  )
}

export function parsePolicyJson(rawJson: string | null): PolicyRecord | null {
  if (!rawJson) return null
  try {
    return asRecord(JSON.parse(rawJson))
  } catch {
    return null
  }
}

export function resolveReschedulePolicy(rawJson: string | null): ReschedulePolicy {
  const record = parsePolicyJson(rawJson)
  const priceDeltaHandlingObject = asRecord(record?.priceDeltaHandling)
  const priceDeltaHandlingRaw =
    normalizePriceDeltaHandling(record?.priceDeltaHandling) ??
    normalizePriceDeltaHandling(priceDeltaHandlingObject?.client) ??
    normalizePriceDeltaHandling(priceDeltaHandlingObject?.mode)
  const allowClientNegativeDelta =
    parseBoolean(record?.allowClientNegativeDelta) ??
    (priceDeltaHandlingRaw ? allowsNegativeDelta(priceDeltaHandlingRaw) : null) ??
    DEFAULT_RESCHEDULE_ALLOW_CLIENT_NEGATIVE_DELTA
  const cutoffCandidate =
    parseInteger(record?.rescheduleCutoffMinutesBeforeStart) ??
    parseInteger(record?.cutoffMinutesBeforeStart) ??
    parseInteger(record?.rescheduleCutoffMinutes) ??
    parseInteger(record?.cutoffMinutes)
  const maxCandidate =
    parseInteger(record?.maxReschedulesPerBooking) ??
    parseInteger(record?.maxReschedules)
  const holdTtlCandidate =
    parseInteger(record?.rescheduleHoldTtlMinutes) ??
    parseInteger(record?.holdTtlMinutes)

  return {
    rescheduleEnabled:
      parseBoolean(record?.rescheduleEnabled) ??
      parseBoolean(record?.enabled) ??
      DEFAULT_RESCHEDULE_ENABLED,
    rescheduleCutoffMinutesBeforeStart:
      cutoffCandidate != null && cutoffCandidate >= 0
        ? cutoffCandidate
        : DEFAULT_RESCHEDULE_CUTOFF_MINUTES,
    maxReschedulesPerBooking:
      maxCandidate != null && maxCandidate >= 0
        ? maxCandidate
        : DEFAULT_RESCHEDULE_MAX_PER_BOOKING,
    allowRescheduleAfterStart:
      parseBoolean(record?.allowRescheduleAfterStart) ??
      parseBoolean(record?.allowAfterStart) ??
      DEFAULT_RESCHEDULE_ALLOW_AFTER_START,
    rescheduleHoldTtlMinutes:
      holdTtlCandidate != null && holdTtlCandidate >= 1
        ? holdTtlCandidate
        : DEFAULT_RESCHEDULE_HOLD_TTL_MINUTES,
    allowClientNegativeDelta,
  }
}

export function resolveCancellationPolicy(rawJson: string | null): CancellationPolicy {
  const record = parsePolicyJson(rawJson)
  const candidate =
    parseInteger(record?.cutoffMinutes) ??
    parseInteger(record?.cancelCutoffMinutes) ??
    parseInteger(record?.minutesBeforeStart)

  const cutoffMinutes =
    candidate != null && candidate >= 0 ? candidate : DEFAULT_CANCELLATION_CUTOFF_MINUTES
  return { cutoffMinutes }
}

export function resolveCheckInPolicy(rawJson: string | null): CheckInPolicy {
  const record = parsePolicyJson(rawJson)
  const openBefore =
    parseInteger(record?.openBeforeMinutes) ??
    parseInteger(record?.checkInOpenBeforeMinutes) ??
    parseInteger(record?.allowedBeforeMinutes)
  const closeAfter =
    parseInteger(record?.closeAfterMinutes) ??
    parseInteger(record?.checkInCloseAfterMinutes) ??
    parseInteger(record?.allowedAfterMinutes)

  return {
    openBeforeMinutes:
      openBefore != null && openBefore >= 0
        ? openBefore
        : DEFAULT_CHECKIN_OPEN_BEFORE_MINUTES,
    closeAfterMinutes:
      closeAfter != null && closeAfter >= 0
        ? closeAfter
        : DEFAULT_CHECKIN_CLOSE_AFTER_MINUTES,
  }
}

export function isCancellationAllowed(params: {
  slotStartAt: Date
  now?: Date
  policyJson: string | null
}) {
  const now = params.now ?? new Date()
  const policy = resolveCancellationPolicy(params.policyJson)
  if (policy.cutoffMinutes <= 0) return true

  const cutoffBoundary = new Date(params.slotStartAt.getTime() - policy.cutoffMinutes * 60_000)
  return now < cutoffBoundary
}

export function isCheckInAllowed(params: {
  slotStartAt: Date
  now?: Date
  policyJson: string | null
}) {
  const now = params.now ?? new Date()
  const policy = resolveCheckInPolicy(params.policyJson)
  const opensAt = new Date(params.slotStartAt.getTime() - policy.openBeforeMinutes * 60_000)
  const closesAt = new Date(params.slotStartAt.getTime() + policy.closeAfterMinutes * 60_000)
  return now >= opensAt && now <= closesAt
}
