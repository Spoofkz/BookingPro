'use client'

import { Role } from '@prisma/client'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import AccountSettingsSection from '@/src/components/account/AccountSettingsSection'
import FinanceAnalyticsSection from '@/src/components/cabinet/FinanceAnalyticsSection'
import FinanceInvoicesSection from '@/src/components/cabinet/FinanceInvoicesSection'
import OnboardingSection from '@/src/components/cabinet/OnboardingSection'
import SimpleSeatMapEditor from '@/src/components/cabinet/SimpleSeatMapEditor'

type MeResponse = {
  activeClubId: string | null
  clubs: Array<{ id: string; name: string; slug: string }>
}

type Room = {
  id: number
  name: string
}

type Segment = {
  id: string
  name: string
  isActive: boolean
}

type PricingPackage = {
  id: string
  name: string
  durationMinutes: number
  pricingType: string
  isActive: boolean
}

type PricingVersion = {
  id: string
  versionNumber: number
  status: string
  effectiveFrom: string
  effectiveTo: string | null
  publishedAt: string | null
  _count?: { rules: number }
}

type PricingRuleRecord = {
  id: string
  ruleType: string
  priority: number
  scopeType: 'SEGMENT' | 'ROOM'
  scopeId: string
  dayOfWeekCsv?: string | null
  timeWindowStartMinute?: number | null
  timeWindowEndMinute?: number | null
  channel?: string | null
  customerType?: string | null
  setRatePerHourCents?: number | null
  addPercent?: number | null
  addFixedAmountCents?: number | null
  addFixedMode?: string | null
  exclusive?: boolean | null
  label?: string | null
}

type PricingVersionDetail = PricingVersion & {
  rules: PricingRuleRecord[]
}

type PricingRuleInput = {
  ruleType: string
  priority?: number
  scopeType: 'SEGMENT' | 'ROOM'
  scopeId: string
  dayOfWeek?: number[]
  timeWindowStartMinute?: number
  timeWindowEndMinute?: number
  channel?: string
  customerType?: string
  setRatePerHourCents?: number
  addPercent?: number
  addFixedAmountCents?: number
  addFixedMode?: string
  exclusive?: boolean
  label?: string
}

type QuoteResponse = {
  quoteId: string
  currency: string
  pricingVersionId: string
  total: number
  breakdown: Array<{
    type: string
    label: string
    amount: number
  }>
  validUntil: string
  slot?: {
    id: string
    startAt: string
    endAt: string
  } | null
  seat?: {
    seatId: string
    label: string
    segmentId: string
    roomId: string | null
  } | null
}

type SeatMapFloor = {
  rooms?: unknown[]
  elements?: Array<{ type?: string }>
}

type SeatMapDocument = {
  mapId: string
  version: number
  floors: SeatMapFloor[]
}

type MapDraftResponse = {
  mapId: string
  clubId: string
  draftRevision: number
  createdAt: string
  updatedAt: string
  updatedByUserId: string | null
  draft: SeatMapDocument
}

type MapVersionItem = {
  id: string
  versionNumber: number
  seatCount: number
  publishedAt: string
  publishedByUserId: string | null
}

type MapVersionsResponse = {
  mapId: string | null
  items: MapVersionItem[]
}

type PublishResult = {
  mapId: string
  mapVersionId: string
  versionNumber: number
  seatCount: number
  publishedAt: string
  publishedByUserId: string | null
  draftRevision: number
  warnings?: string[]
  diffSummary?: {
    added: number
    removed: number
    updated: number
    disabledChanged?: number
  }
  seatCountByFloor?: Array<{
    floorId: string
    seatCount: number
  }>
}

type MapStats = {
  floors: number
  rooms: number
  seats: number
  walls: number
  parseError: string | null
}

type PreviewRect = {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

type PreviewPolyline = {
  type: 'polyline'
  points: Array<[number, number]>
  thickness?: number
}

type PreviewRoom = {
  roomId: string
  name: string
  shape: PreviewRect
}

type PreviewSeatElement = {
  type: 'seat'
  seatId: string
  label: string
  segmentId: string
  isDisabled: boolean
  disableReason: string | null
  shape: PreviewRect
}

type PreviewWallElement = {
  type: 'wall'
  shape: PreviewPolyline
}

type PreviewElement = PreviewSeatElement | PreviewWallElement

type PreviewFloor = {
  floorId: string
  name: string
  plane: {
    width: number
    height: number
  }
  rooms: PreviewRoom[]
  elements: PreviewElement[]
}

type PreviewMapDocument = {
  mapId: string
  version: number
  floors: PreviewFloor[]
}

type SeatSnapshot = {
  seatId: string
  label: string
  segmentId: string
  roomId: string | null
  seatType: string
  isDisabled: boolean
  disableReason: string | null
  geometryKey: string
}

type PublishedSeatsResponse = {
  versionNumber: number
  seats: Array<{
    seatId: string
    roomId: string | null
    segmentId: string
    label: string
    seatType: string
    geometry: unknown
    isDisabled?: boolean
    disabledReason?: string | null
  }>
}

type MapPublishPreview = {
  generatedAt: string
  againstVersionNumber: number | null
  added: SeatSnapshot[]
  removed: SeatSnapshot[]
  updated: Array<{
    before: SeatSnapshot
    after: SeatSnapshot
  }>
}

type ClubDetailsResponse = {
  id: string
  name: string
  status: string
  timezone: string
  currency: string
  businessHoursText: string | null
  holdTtlMinutes: number | null
  cancellationPolicy: Record<string, unknown> | null
  checkInPolicy: Record<string, unknown> | null
  schedulePublishedAt: string | null
  slotsGeneratedUntil: string | null
}

type ClubMembersResponse = {
  items: Array<{
    id: string
    role: Role
    status: 'ACTIVE' | 'INVITED' | 'DISABLED'
    user: {
      id: string
      name: string
      email: string | null
      phone: string | null
    }
  }>
}

type StaffFormState = {
  email: string
  role: 'HOST_ADMIN' | 'TECH_ADMIN'
}

type AuditResponse = {
  items: Array<{
    id: number
    createdAt: string
    action: string
    entityType: string
    entityId: string
    metadata: string | null
    actor: {
      id: string
      name: string
      email: string | null
      phone: string | null
    } | null
  }>
}

type WeekdayKey =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

type WeeklyDayForm = {
  closed: boolean
  openTime: string
  closeTime: string
}

type WeeklyHoursForm = Record<WeekdayKey, WeeklyDayForm>

type ScheduleTemplateResponse = {
  exists: boolean
  template: {
    id: string | null
    slotDurationMinutes: number
    bookingLeadTimeMinutes: number
    maxAdvanceDays: number
    weeklyHours: Record<
      WeekdayKey,
      {
        closed: boolean
        openTime: string | null
        closeTime: string | null
      }
    >
    effectiveFrom: string | null
    revision: number
    updatedAt: string | null
  }
  timezone: string
}

type ScheduleExceptionItem = {
  id: string
  type: 'CLOSED_ALL_DAY' | 'CLOSED_RANGE' | 'SPECIAL_HOURS' | 'BLOCKED_RANGE'
  startAt: string
  endAt: string
  reason: string | null
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
}

type ScheduleExceptionsResponse = {
  items: ScheduleExceptionItem[]
}

type SchedulePublishResponse = {
  schedulePublishedAt: string
  slotsGeneratedUntil: string
  result: {
    created: number
    updated: number
    blocked: number
    locked: number
    deleted?: number
  }
}

type ScheduleSlotsResponse = {
  items: Array<{
    slotId: string
    startAt: string
    endAt: string
    localDate: string
    status: 'PUBLISHED' | 'BLOCKED' | 'CANCELLED_LOCKED'
  }>
}

const WEEKDAY_ORDER: WeekdayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
}

function toLocalInputValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function toDateInputValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10)
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function fromDateTimeLocalValue(value: string) {
  if (!value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function createDefaultWeeklyHoursForm(): WeeklyHoursForm {
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

function normalizeWeeklyHoursForForm(
  value:
    | Record<
        WeekdayKey,
        {
          closed: boolean
          openTime: string | null
          closeTime: string | null
        }
      >
    | undefined,
): WeeklyHoursForm {
  const fallback = createDefaultWeeklyHoursForm()
  if (!value) return fallback
  const next = { ...fallback }
  for (const day of WEEKDAY_ORDER) {
    const source = value[day]
    if (!source) continue
    next[day] = {
      closed: source.closed === true,
      openTime: source.openTime?.trim() || '10:00',
      closeTime: source.closeTime?.trim() || '22:00',
    }
  }
  return next
}

function parseRevisionFromEtag(value: string | null) {
  if (!value) return null
  const normalized = value.trim().replace(/^W\//, '').replaceAll('"', '')
  const revision = Number(normalized)
  if (!Number.isInteger(revision) || revision <= 0) return null
  return revision
}

function errorMessageFromPayload(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback

  const record = payload as Record<string, unknown>
  const primary = typeof record.error === 'string' && record.error.trim() ? record.error : fallback
  const validationErrors = Array.isArray(record.errors)
    ? record.errors.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  if (validationErrors.length === 0) return primary
  return `${primary} ${validationErrors.join(' ')}`
}

function warningsFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  return Array.isArray(record.warnings)
    ? record.warnings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatMoney(amountKzt: number, _currency: string) {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

async function readJsonOrThrow<T>(response: Response, fallbackError: string) {
  const payload = (await response.json()) as T | unknown
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload, fallbackError))
  }
  return payload as T
}

function mapStatsFromDraftText(text: string): MapStats {
  if (!text.trim()) {
    return {
      floors: 0,
      rooms: 0,
      seats: 0,
      walls: 0,
      parseError: null,
    }
  }

  try {
    const draft = JSON.parse(text) as { floors?: unknown }
    if (!Array.isArray(draft.floors)) {
      return {
        floors: 0,
        rooms: 0,
        seats: 0,
        walls: 0,
        parseError: 'Draft JSON is missing a floors array.',
      }
    }

    let rooms = 0
    let seats = 0
    let walls = 0

    for (const floor of draft.floors) {
      if (!floor || typeof floor !== 'object') continue
      const floorData = floor as SeatMapFloor
      if (Array.isArray(floorData.rooms)) {
        rooms += floorData.rooms.length
      }
      if (Array.isArray(floorData.elements)) {
        for (const element of floorData.elements) {
          if (element?.type === 'seat') seats += 1
          if (element?.type === 'wall') walls += 1
        }
      }
    }

    return {
      floors: draft.floors.length,
      rooms,
      seats,
      walls,
      parseError: null,
    }
  } catch {
    return {
      floors: 0,
      rooms: 0,
      seats: 0,
      walls: 0,
      parseError: 'Draft JSON is not valid.',
    }
  }
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function asBoolean(value: unknown) {
  if (typeof value !== 'boolean') return null
  return value
}

function parsePreviewRect(value: unknown) {
  const record = asRecord(value)
  if (!record || record.type !== 'rect') return null
  const x = asNumber(record.x)
  const y = asNumber(record.y)
  const w = asNumber(record.w)
  const h = asNumber(record.h)
  const rotation = asNumber(record.rotation) ?? 0
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null
  return {
    type: 'rect' as const,
    x,
    y,
    w,
    h,
    rotation,
  }
}

function parsePreviewPolyline(value: unknown) {
  const record = asRecord(value)
  if (!record || record.type !== 'polyline' || !Array.isArray(record.points)) return null
  const points: Array<[number, number]> = []
  for (const point of record.points) {
    if (!Array.isArray(point) || point.length !== 2) return null
    const x = asNumber(point[0])
    const y = asNumber(point[1])
    if (x == null || y == null) return null
    points.push([x, y])
  }
  if (points.length < 2) return null
  const thickness = asNumber(record.thickness) ?? 6
  return {
    type: 'polyline' as const,
    points,
    thickness,
  }
}

function parseMapDocumentForPreview(text: string): {
  document: PreviewMapDocument | null
  error: string | null
} {
  if (!text.trim()) return { document: null, error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { document: null, error: 'Draft JSON is not valid.' }
  }

  const root = asRecord(parsed)
  if (!root) return { document: null, error: 'Map draft must be an object.' }

  const mapId = asString(root.mapId)
  const version = asNumber(root.version)
  if (!mapId || version == null) {
    return { document: null, error: 'Map draft requires mapId and version.' }
  }

  if (!Array.isArray(root.floors)) {
    return { document: null, error: 'Map draft requires floors array.' }
  }

  const floors: PreviewFloor[] = []
  for (let floorIndex = 0; floorIndex < root.floors.length; floorIndex += 1) {
    const floorRecord = asRecord(root.floors[floorIndex])
    if (!floorRecord) continue

    const floorId = asString(floorRecord.floorId) ?? `floor-${floorIndex + 1}`
    const floorName = asString(floorRecord.name) ?? floorId
    const planeRecord = asRecord(floorRecord.plane)
    const width = planeRecord ? asNumber(planeRecord.width) : null
    const height = planeRecord ? asNumber(planeRecord.height) : null
    if (width == null || height == null || width <= 0 || height <= 0) continue

    const rooms: PreviewRoom[] = []
    if (Array.isArray(floorRecord.rooms)) {
      for (const room of floorRecord.rooms) {
        const roomRecord = asRecord(room)
        if (!roomRecord) continue
        const roomId = asString(roomRecord.roomId)
        const name = asString(roomRecord.name)
        const shape = parsePreviewRect(roomRecord.shape)
        if (!roomId || !name || !shape) continue
        rooms.push({ roomId, name, shape })
      }
    }

    const elements: PreviewElement[] = []
    if (Array.isArray(floorRecord.elements)) {
      for (const element of floorRecord.elements) {
        const elementRecord = asRecord(element)
        if (!elementRecord) continue
        const type = asString(elementRecord.type)

        if (type === 'seat') {
          const seatId = asString(elementRecord.seatId)
          const label = asString(elementRecord.label)
          const segmentId = asString(elementRecord.segmentId) ?? ''
          const isDisabled = asBoolean(elementRecord.isDisabled) ?? false
          const disableReason = asString(elementRecord.disableReason)
          const shape = parsePreviewRect(elementRecord.shape)
          if (!seatId || !label || !shape) continue
          elements.push({
            type: 'seat',
            seatId,
            label,
            segmentId,
            isDisabled,
            disableReason: disableReason ?? null,
            shape,
          })
          continue
        }

        if (type === 'wall') {
          const shape = parsePreviewPolyline(elementRecord.shape)
          if (!shape) continue
          elements.push({
            type: 'wall',
            shape,
          })
        }
      }
    }

    floors.push({
      floorId,
      name: floorName,
      plane: { width, height },
      rooms,
      elements,
    })
  }

  return {
    document: {
      mapId,
      version,
      floors,
    },
    error: null,
  }
}

function colorFromSegment(segmentId: string) {
  if (!segmentId) return '#38bdf8'
  let hash = 0
  for (let index = 0; index < segmentId.length; index += 1) {
    hash = (hash * 31 + segmentId.charCodeAt(index)) % 360
  }
  return `hsl(${hash} 72% 52%)`
}

function normalizeRectShape(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.type !== 'rect') return null

  const x = typeof record.x === 'number' ? record.x : null
  const y = typeof record.y === 'number' ? record.y : null
  const w = typeof record.w === 'number' ? record.w : null
  const h = typeof record.h === 'number' ? record.h : null
  const rotation = typeof record.rotation === 'number' ? record.rotation : 0

  if (x == null || y == null || w == null || h == null) return null
  return {
    type: 'rect',
    x,
    y,
    w,
    h,
    rotation,
  }
}

function seatSnapshotsFromDraft(input: unknown): SeatSnapshot[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const record = input as Record<string, unknown>
  if (!Array.isArray(record.floors)) return []

  const snapshots: SeatSnapshot[] = []

  for (const floor of record.floors) {
    if (!floor || typeof floor !== 'object' || Array.isArray(floor)) continue
    const floorRecord = floor as Record<string, unknown>
    if (!Array.isArray(floorRecord.elements)) continue

    for (const element of floorRecord.elements) {
      if (!element || typeof element !== 'object' || Array.isArray(element)) continue
      const seat = element as Record<string, unknown>
      if (seat.type !== 'seat') continue

      const seatId = typeof seat.seatId === 'string' ? seat.seatId.trim() : ''
      if (!seatId) continue

      const labelRaw = typeof seat.label === 'string' ? seat.label.trim() : ''
      const segmentId = typeof seat.segmentId === 'string' ? seat.segmentId.trim() : ''
      const roomIdRaw = typeof seat.roomId === 'string' ? seat.roomId.trim() : ''
      const seatType = typeof seat.seatType === 'string' ? seat.seatType.trim() : 'OTHER'
      const isDisabled = seat.isDisabled === true
      const disableReason =
        typeof seat.disableReason === 'string' && seat.disableReason.trim()
          ? seat.disableReason.trim()
          : null
      const normalizedShape = normalizeRectShape(seat.shape)
      const geometryKey = JSON.stringify(normalizedShape ?? seat.shape ?? null)

      snapshots.push({
        seatId,
        label: labelRaw || seatId,
        segmentId,
        roomId: roomIdRaw || null,
        seatType: seatType || 'OTHER',
        isDisabled,
        disableReason,
        geometryKey,
      })
    }
  }

  snapshots.sort((a, b) => a.label.localeCompare(b.label))
  return snapshots
}

function seatSnapshotsFromPublished(response: PublishedSeatsResponse): SeatSnapshot[] {
  return response.seats
    .map((seat) => ({
      seatId: seat.seatId,
      label: seat.label || seat.seatId,
      segmentId: seat.segmentId || '',
      roomId: seat.roomId,
      seatType: seat.seatType || 'OTHER',
      isDisabled: seat.isDisabled === true,
      disableReason:
        typeof seat.disabledReason === 'string' && seat.disabledReason.trim()
          ? seat.disabledReason.trim()
          : null,
      geometryKey: JSON.stringify(normalizeRectShape(seat.geometry) ?? seat.geometry ?? null),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function seatsEqual(left: SeatSnapshot, right: SeatSnapshot) {
  return (
    left.label === right.label &&
    left.segmentId === right.segmentId &&
    left.roomId === right.roomId &&
    left.seatType === right.seatType &&
    left.isDisabled === right.isDisabled &&
    left.disableReason === right.disableReason &&
    left.geometryKey === right.geometryKey
  )
}

function parseDayOfWeekCsv(csv?: string | null) {
  if (!csv) return undefined
  const values = csv
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
  if (values.length < 1) return undefined
  return Array.from(new Set(values))
}

function pricingRuleRecordToInput(rule: PricingRuleRecord): PricingRuleInput {
  const output: PricingRuleInput = {
    ruleType: rule.ruleType,
    priority: rule.priority,
    scopeType: rule.scopeType,
    scopeId: String(rule.scopeId),
    exclusive: Boolean(rule.exclusive),
  }
  const days = parseDayOfWeekCsv(rule.dayOfWeekCsv)
  if (days && days.length > 0) output.dayOfWeek = days
  if (typeof rule.timeWindowStartMinute === 'number') {
    output.timeWindowStartMinute = rule.timeWindowStartMinute
  }
  if (typeof rule.timeWindowEndMinute === 'number') {
    output.timeWindowEndMinute = rule.timeWindowEndMinute
  }
  if (typeof rule.channel === 'string' && rule.channel) output.channel = rule.channel
  if (typeof rule.customerType === 'string' && rule.customerType) output.customerType = rule.customerType
  if (typeof rule.setRatePerHourCents === 'number') output.setRatePerHourCents = rule.setRatePerHourCents
  if (typeof rule.addPercent === 'number') output.addPercent = rule.addPercent
  if (typeof rule.addFixedAmountCents === 'number') output.addFixedAmountCents = rule.addFixedAmountCents
  if (typeof rule.addFixedMode === 'string' && rule.addFixedMode) output.addFixedMode = rule.addFixedMode
  if (typeof rule.label === 'string' && rule.label.trim()) output.label = rule.label
  return output
}

export default function TechSection({ section }: { section: string }) {
  const knownSections = new Set([
    'overview',
    'onboarding',
    'map-editor',
    'pricing',
    'schedule',
    'staff',
    'finance',
    'payments',
    'policies',
    'audit',
    'account',
  ])
  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [segments, setSegments] = useState<Segment[]>([])
  const [packages, setPackages] = useState<PricingPackage[]>([])
  const [pricingVersions, setPricingVersions] = useState<PricingVersion[]>([])
  const [selectedPricingDraftId, setSelectedPricingDraftId] = useState('')
  const [selectedPricingVersionDetail, setSelectedPricingVersionDetail] = useState<PricingVersionDetail | null>(null)
  const [segmentBaseRates, setSegmentBaseRates] = useState<Record<string, string>>({})
  const [segmentForm, setSegmentForm] = useState({ name: '' })
  const [segmentBusy, setSegmentBusy] = useState(false)
  const [bookingsCount, setBookingsCount] = useState(0)
  const [quoteResult, setQuoteResult] = useState<QuoteResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pricingLoading, setPricingLoading] = useState(false)
  const [pricingRulesBusy, setPricingRulesBusy] = useState(false)
  const [pricingMessage, setPricingMessage] = useState<string | null>(null)
  const [pricingValidation, setPricingValidation] = useState<Record<string, string[]> | null>(null)
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(null)

  const [mapLoading, setMapLoading] = useState(false)
  const [mapBusy, setMapBusy] = useState(false)
  const [mapMessage, setMapMessage] = useState<string | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapDraftRevision, setMapDraftRevision] = useState<number | null>(null)
  const [mapDraftText, setMapDraftText] = useState('')
  const [mapLoadedSnapshot, setMapLoadedSnapshot] = useState('')
  const [mapMetadata, setMapMetadata] = useState<{
    mapId: string
    createdAt: string
    updatedAt: string
    updatedByUserId: string | null
  } | null>(null)
  const [mapVersions, setMapVersions] = useState<MapVersionItem[]>([])
  const [mapPublishResult, setMapPublishResult] = useState<PublishResult | null>(null)
  const [mapPreviewLoading, setMapPreviewLoading] = useState(false)
  const [mapPublishPreview, setMapPublishPreview] = useState<MapPublishPreview | null>(null)
  const [previewFloorId, setPreviewFloorId] = useState('')

  const [quoteForm, setQuoteForm] = useState({
    roomId: '',
    packageId: '',
    promoCode: '',
    startAt: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
    endAt: toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
  })

  const [clubDetails, setClubDetails] = useState<ClubDetailsResponse | null>(null)
  const [members, setMembers] = useState<ClubMembersResponse['items']>([])
  const [auditItems, setAuditItems] = useState<AuditResponse['items']>([])
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminMessage, setAdminMessage] = useState<string | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [staffForm, setStaffForm] = useState<StaffFormState>({
    email: '',
    role: Role.HOST_ADMIN,
  })
  const [scheduleForm, setScheduleForm] = useState({
    slotsGeneratedUntil: '',
    businessHoursText: '',
    horizonDays: '30',
    previewDate: toDateInputValue(new Date()),
  })
  const [scheduleTemplateExists, setScheduleTemplateExists] = useState(false)
  const [scheduleTemplateRevision, setScheduleTemplateRevision] = useState(0)
  const [scheduleTemplateUpdatedAt, setScheduleTemplateUpdatedAt] = useState<string | null>(null)
  const [scheduleTemplateForm, setScheduleTemplateForm] = useState({
    slotDurationMinutes: '60',
    bookingLeadTimeMinutes: '0',
    maxAdvanceDays: '30',
    effectiveFrom: '',
    weeklyHours: createDefaultWeeklyHoursForm(),
  })
  const [scheduleExceptions, setScheduleExceptions] = useState<ScheduleExceptionItem[]>([])
  const [scheduleExceptionForm, setScheduleExceptionForm] = useState({
    type: 'CLOSED_RANGE' as ScheduleExceptionItem['type'],
    startAt: toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    endAt: toLocalInputValue(new Date(Date.now() + 3 * 60 * 60 * 1000)),
    reason: '',
  })
  const [schedulePreviewSlots, setSchedulePreviewSlots] = useState<ScheduleSlotsResponse['items']>([])
  const [schedulePublishResult, setSchedulePublishResult] = useState<SchedulePublishResponse | null>(null)
  const [policyForm, setPolicyForm] = useState({
    holdTtlMinutes: '15',
    cancellationPolicyJson: '{}',
    checkInPolicyJson: '{}',
  })
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null)
  const [auditFilters, setAuditFilters] = useState({
    action: '',
    entityType: '',
    dateFrom: '',
    dateTo: '',
  })

  async function loadBaseData() {
    const meResponse = await fetch('/api/me', { cache: 'no-store' })
    if (!meResponse.ok) {
      throw new Error('Failed to load user context.')
    }

    const meData = (await meResponse.json()) as MeResponse
    setActiveClubId(meData.activeClubId)
  }

  async function loadOperationalData(clubId: string) {
    const [roomsResponse, bookingsResponse] = await Promise.all([
      fetch('/api/rooms', {
        cache: 'no-store',
        headers: {
          'X-Club-Id': clubId,
        },
      }),
      fetch('/api/bookings?scope=club&pageSize=1', {
        cache: 'no-store',
        headers: {
          'X-Club-Id': clubId,
        },
      }),
    ])

    const roomData = await readJsonOrThrow<Room[]>(roomsResponse, 'Failed to load rooms.')
    const bookingData = await readJsonOrThrow<{ total: number }>(
      bookingsResponse,
      'Failed to load bookings summary.',
    )

    setRooms(roomData)
    setQuoteForm((current) => ({
      ...current,
      roomId: current.roomId || String(roomData[0]?.id ?? ''),
    }))
    setBookingsCount(bookingData.total ?? 0)
  }

  async function loadAuditEntries(
    clubId: string,
    filters: {
      action?: string
      entityType?: string
      dateFrom?: string
      dateTo?: string
    } = {},
  ) {
    const searchParams = new URLSearchParams()
    if (filters.action) searchParams.set('action', filters.action)
    if (filters.entityType) searchParams.set('entityType', filters.entityType)
    if (filters.dateFrom) searchParams.set('dateFrom', filters.dateFrom)
    if (filters.dateTo) searchParams.set('dateTo', filters.dateTo)
    searchParams.set('pageSize', '50')

    const response = await fetch(
      `/api/clubs/${clubId}/audit?${searchParams.toString()}`,
      { cache: 'no-store' },
    )
    const payload = await readJsonOrThrow<AuditResponse>(response, 'Failed to load audit entries.')
    setAuditItems(payload.items)
  }

  async function loadClubAdminData(clubId: string) {
    const [clubResponse, membersResponse] = await Promise.all([
      fetch(`/api/clubs/${clubId}`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/members`, { cache: 'no-store' }),
    ])

    const clubPayload = await readJsonOrThrow<ClubDetailsResponse>(
      clubResponse,
      'Failed to load club profile.',
    )
    const membersPayload = await readJsonOrThrow<ClubMembersResponse>(
      membersResponse,
      'Failed to load club members.',
    )

    setClubDetails(clubPayload)
    setMembers(membersPayload.items)
    setScheduleForm({
      slotsGeneratedUntil: toDateTimeLocalValue(clubPayload.slotsGeneratedUntil),
      businessHoursText: clubPayload.businessHoursText || '',
      horizonDays: '30',
      previewDate: toDateInputValue(new Date()),
    })
    setPolicyForm({
      holdTtlMinutes: String(clubPayload.holdTtlMinutes ?? 15),
      cancellationPolicyJson: JSON.stringify(clubPayload.cancellationPolicy ?? {}, null, 2),
      checkInPolicyJson: JSON.stringify(clubPayload.checkInPolicy ?? {}, null, 2),
    })
    await loadAuditEntries(clubId, {})
  }

  async function loadSchedulePreviewSlots(clubId: string, date: string) {
    if (!date.trim()) {
      setSchedulePreviewSlots([])
      return
    }
    const response = await fetch(
      `/api/clubs/${clubId}/slots?date=${encodeURIComponent(date)}`,
      { cache: 'no-store' },
    )
    const payload = await readJsonOrThrow<ScheduleSlotsResponse>(
      response,
      'Failed to load slots preview.',
    )
    setSchedulePreviewSlots(payload.items)
  }

  async function loadScheduleData(clubId: string) {
    const [templateResponse, exceptionsResponse] = await Promise.all([
      fetch(`/api/clubs/${clubId}/schedule/template`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/schedule/exceptions`, { cache: 'no-store' }),
    ])

    const templatePayload = await readJsonOrThrow<ScheduleTemplateResponse>(
      templateResponse,
      'Failed to load schedule template.',
    )
    const exceptionsPayload = await readJsonOrThrow<ScheduleExceptionsResponse>(
      exceptionsResponse,
      'Failed to load schedule exceptions.',
    )

    setScheduleTemplateExists(templatePayload.exists)
    setScheduleTemplateRevision(templatePayload.template.revision)
    setScheduleTemplateUpdatedAt(templatePayload.template.updatedAt)
    setScheduleTemplateForm({
      slotDurationMinutes: String(templatePayload.template.slotDurationMinutes),
      bookingLeadTimeMinutes: String(templatePayload.template.bookingLeadTimeMinutes),
      maxAdvanceDays: String(templatePayload.template.maxAdvanceDays),
      effectiveFrom: toDateTimeLocalValue(templatePayload.template.effectiveFrom),
      weeklyHours: normalizeWeeklyHoursForForm(templatePayload.template.weeklyHours),
    })
    setScheduleExceptions(exceptionsPayload.items)

    await loadSchedulePreviewSlots(clubId, scheduleForm.previewDate)
  }

  async function loadPricingData(clubId: string) {
    const [segmentsResponse, packagesResponse, versionsResponse] = await Promise.all([
      fetch(`/api/clubs/${clubId}/segments`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/packages`, { cache: 'no-store' }),
      fetch(`/api/clubs/${clubId}/pricing/versions`, { cache: 'no-store' }),
    ])

    if (segmentsResponse.ok) {
      setSegments((await segmentsResponse.json()) as Segment[])
    }
    if (packagesResponse.ok) {
      setPackages((await packagesResponse.json()) as PricingPackage[])
      setQuoteForm((current) => ({
        ...current,
        packageId: current.packageId || '',
      }))
    }
    if (versionsResponse.ok) {
      const versions = (await versionsResponse.json()) as PricingVersion[]
      setPricingVersions(versions)
      setSelectedPricingDraftId((current) => {
        if (current && versions.some((version) => version.id === current && version.status === 'DRAFT')) {
          return current
        }
        const latestDraft = versions.find((version) => version.status === 'DRAFT')
        return latestDraft?.id || ''
      })
    }
    setPricingValidation(null)
  }

  async function loadPricingVersionDetail(clubId: string, pricingVersionId: string) {
    const response = await fetch(`/api/clubs/${clubId}/pricing/versions/${pricingVersionId}`, {
      cache: 'no-store',
    })
    const payload = (await response.json()) as PricingVersionDetail | unknown
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, 'Failed to load pricing version detail.'))
    }
    const detail = payload as PricingVersionDetail
    setSelectedPricingVersionDetail(detail)
  }

  async function loadMapVersions(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/map/versions`, { cache: 'no-store' })
    if (!response.ok) {
      const payload = (await response.json()) as unknown
      throw new Error(errorMessageFromPayload(payload, 'Failed to load map versions.'))
    }

    const payload = (await response.json()) as MapVersionsResponse
    setMapVersions(payload.items ?? [])
  }

  async function loadMapDraft(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/map/draft`, { cache: 'no-store' })
    if (response.status === 404) {
      setMapMetadata(null)
      setMapDraftRevision(null)
      setMapDraftText('')
      setMapLoadedSnapshot('')
      return false
    }

    const payload = (await response.json()) as MapDraftResponse | unknown
    if (!response.ok) {
      throw new Error(errorMessageFromPayload(payload, 'Failed to load map draft.'))
    }

    const draftPayload = payload as MapDraftResponse
    const draftText = JSON.stringify(draftPayload.draft, null, 2)
    setMapMetadata({
      mapId: draftPayload.mapId,
      createdAt: draftPayload.createdAt,
      updatedAt: draftPayload.updatedAt,
      updatedByUserId: draftPayload.updatedByUserId,
    })
    setMapDraftRevision(parseRevisionFromEtag(response.headers.get('etag')) ?? draftPayload.draftRevision)
    setMapDraftText(draftText)
    setMapLoadedSnapshot(draftText)
    return true
  }

  async function loadMapEditorData(clubId: string) {
    setMapLoading(true)
    setMapError(null)
    try {
      const [hasDraft] = await Promise.all([loadMapDraft(clubId), loadMapVersions(clubId)])
      setMapPublishPreview(null)
      if (!hasDraft) {
        setMapMessage('Map draft is not initialized. Create one to start editing.')
      }
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Failed to load map editor data.')
    } finally {
      setMapLoading(false)
    }
  }

  async function loadLatestPublishedSeatSnapshots(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/seats?mapVersion=latest`, { cache: 'no-store' })
    if (response.status === 404) {
      return {
        versionNumber: null,
        seats: [] as SeatSnapshot[],
      }
    }
    if (!response.ok) {
      const payload = (await response.json()) as unknown
      throw new Error(errorMessageFromPayload(payload, 'Failed to load latest published seats.'))
    }

    const payload = (await response.json()) as PublishedSeatsResponse
    return {
      versionNumber: payload.versionNumber,
      seats: seatSnapshotsFromPublished(payload),
    }
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        await loadBaseData()
      } catch (error) {
        if (mounted) {
          setAdminError(error instanceof Error ? error.message : 'Failed to load cabinet context.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [])

  // loadMapEditorData is intentionally called only when active club changes
  // because it hydrates map state for the selected club.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!activeClubId) {
      setRooms([])
      setBookingsCount(0)
      setSegments([])
      setPackages([])
      setPricingVersions([])
      setSelectedPricingDraftId('')
      setSelectedPricingVersionDetail(null)
      setSegmentBaseRates({})
      setPricingValidation(null)
      setPublishingVersionId(null)
      setClubDetails(null)
      setMembers([])
      setAuditItems([])
      setAdminError(null)
      setAdminMessage(null)
      setMapMetadata(null)
      setMapDraftRevision(null)
      setMapDraftText('')
      setMapLoadedSnapshot('')
      setMapVersions([])
      setMapPublishPreview(null)
      setScheduleTemplateExists(false)
      setScheduleTemplateRevision(0)
      setScheduleTemplateUpdatedAt(null)
      setScheduleTemplateForm({
        slotDurationMinutes: '60',
        bookingLeadTimeMinutes: '0',
        maxAdvanceDays: '30',
        effectiveFrom: '',
        weeklyHours: createDefaultWeeklyHoursForm(),
      })
      setScheduleExceptions([])
      setSchedulePreviewSlots([])
      setSchedulePublishResult(null)
      return
    }
    setAdminError(null)
    setAdminMessage(null)
    void loadOperationalData(activeClubId).catch((error) =>
      setAdminError(error instanceof Error ? error.message : 'Failed to load operational data.'),
    )
    void loadPricingData(activeClubId)
    void loadMapEditorData(activeClubId)
    void loadScheduleData(activeClubId).catch((error) =>
      setAdminError(error instanceof Error ? error.message : 'Failed to load schedule data.'),
    )
    void loadClubAdminData(activeClubId).catch((error) =>
      setAdminError(error instanceof Error ? error.message : 'Failed to load club configuration data.'),
    )
  }, [activeClubId])
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!activeClubId || !selectedPricingDraftId) {
      setSelectedPricingVersionDetail(null)
      setSegmentBaseRates({})
      return
    }

    let cancelled = false
    void loadPricingVersionDetail(activeClubId, selectedPricingDraftId).catch((error) => {
        if (!cancelled) {
          setSelectedPricingVersionDetail(null)
          setSegmentBaseRates({})
          setPricingMessage(
            error instanceof Error ? error.message : 'Failed to load pricing rules for selected draft.',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeClubId, selectedPricingDraftId])

  useEffect(() => {
    if (!selectedPricingVersionDetail) {
      setSegmentBaseRates({})
      return
    }
    const baseBySegment = new Map<string, number>()
    for (const rule of selectedPricingVersionDetail.rules || []) {
      if (rule.ruleType !== 'BASE_RATE' || rule.scopeType !== 'SEGMENT') continue
      if (typeof rule.setRatePerHourCents !== 'number') continue
      baseBySegment.set(String(rule.scopeId), rule.setRatePerHourCents)
    }
    setSegmentBaseRates(
      Object.fromEntries(
        segments.map((segment) => [segment.id, String(baseBySegment.get(segment.id) ?? '')]),
      ),
    )
  }, [segments, selectedPricingVersionDetail])

  const checklist = useMemo(() => {
    const hasMap = mapVersions.length > 0 || Boolean(mapMetadata)
    const hasPricing =
      segments.length > 0 && pricingVersions.some((version) => version.status === 'PUBLISHED')
    const hasSchedule =
      Boolean(clubDetails?.schedulePublishedAt) &&
      Boolean(clubDetails?.slotsGeneratedUntil)
    const hasStaff = members.some((member) => member.status === 'ACTIVE')
    return [
      { label: 'Map created', done: hasMap },
      { label: 'Pricing configured', done: hasPricing },
      { label: 'Schedule published', done: hasSchedule },
      { label: 'Staff invited', done: hasStaff },
      { label: 'Club published', done: hasMap && hasPricing && hasSchedule && hasStaff },
    ]
  }, [clubDetails?.schedulePublishedAt, clubDetails?.slotsGeneratedUntil, mapMetadata, mapVersions.length, members, pricingVersions, segments.length])

  const mapStats = useMemo(() => mapStatsFromDraftText(mapDraftText), [mapDraftText])
  const mapDraftDirty = mapDraftText !== mapLoadedSnapshot
  const parsedMapPreview = useMemo(() => parseMapDocumentForPreview(mapDraftText), [mapDraftText])
  const previewFloor = useMemo(() => {
    const floors = parsedMapPreview.document?.floors ?? []
    if (floors.length === 0) return null
    return floors.find((floor) => floor.floorId === previewFloorId) ?? floors[0]
  }, [parsedMapPreview.document?.floors, previewFloorId])

  const draftPricingVersions = useMemo(
    () => pricingVersions.filter((version) => version.status === 'DRAFT'),
    [pricingVersions],
  )
  const latestPublishedPricingVersion = useMemo(
    () => pricingVersions.find((version) => version.status === 'PUBLISHED') ?? null,
    [pricingVersions],
  )
  const selectedPricingDraftVersion = useMemo(
    () => draftPricingVersions.find((version) => version.id === selectedPricingDraftId) ?? null,
    [draftPricingVersions, selectedPricingDraftId],
  )
  const segmentRateCoverage = useMemo(() => {
    const activeSegments = segments.filter((segment) => segment.isActive)
    const configured = activeSegments.filter((segment) => {
      const raw = (segmentBaseRates[segment.id] || '').trim()
      return raw.length > 0 && Number(raw) > 0
    }).length
    return {
      total: activeSegments.length,
      configured,
      missing: Math.max(0, activeSegments.length - configured),
    }
  }, [segmentBaseRates, segments])

  useEffect(() => {
    const floors = parsedMapPreview.document?.floors ?? []
    if (floors.length === 0) {
      if (previewFloorId) setPreviewFloorId('')
      return
    }
    const exists = floors.some((floor) => floor.floorId === previewFloorId)
    if (!exists) {
      setPreviewFloorId(floors[0].floorId)
    }
  }, [parsedMapPreview.document?.floors, previewFloorId])

  async function handleCreateSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return
    const name = segmentForm.name.trim()
    if (!name) {
      setPricingMessage('Segment name is required.')
      return
    }

    setSegmentBusy(true)
    setPricingMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/segments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, isActive: true }),
      })
      const payload = (await response.json()) as unknown
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, 'Failed to create segment.'))
      }
      setSegmentForm({ name: '' })
      setPricingMessage(`Segment "${name}" created.`)
      await loadPricingData(activeClubId)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to create segment.')
    } finally {
      setSegmentBusy(false)
    }
  }

  async function handleCreateDefaultSegments() {
    if (!activeClubId) return
    const defaults = ['Standard', 'Bootcamp', 'VIP']
    const existing = new Set(segments.map((segment) => segment.name.trim().toLowerCase()))
    const missing = defaults.filter((name) => !existing.has(name.toLowerCase()))
    if (missing.length === 0) {
      setPricingMessage('Default segments already exist.')
      return
    }

    setSegmentBusy(true)
    setPricingMessage(null)
    try {
      for (const name of missing) {
        const response = await fetch(`/api/clubs/${activeClubId}/segments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, isActive: true }),
        })
        if (!response.ok && response.status !== 409) {
          const payload = (await response.json()) as unknown
          throw new Error(errorMessageFromPayload(payload, `Failed to create segment "${name}".`))
        }
      }
      setPricingMessage(`Added default segments: ${missing.join(', ')}.`)
      await loadPricingData(activeClubId)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to create default segments.')
    } finally {
      setSegmentBusy(false)
    }
  }

  async function handleToggleSegment(segment: Segment) {
    if (!activeClubId) return
    setSegmentBusy(true)
    setPricingMessage(null)
    try {
      const response = await fetch(`/api/segments/${segment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !segment.isActive }),
      })
      const payload = (await response.json()) as unknown
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, 'Failed to update segment.'))
      }
      setPricingMessage(
        `Segment "${segment.name}" ${segment.isActive ? 'deactivated' : 'activated'}.`,
      )
      await loadPricingData(activeClubId)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to update segment.')
    } finally {
      setSegmentBusy(false)
    }
  }

  async function handleCreateDraftVersion() {
    if (!activeClubId) return
    setPricingLoading(true)
    setPricingMessage(null)
    setPricingValidation(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/pricing/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to create draft pricing version.')
      }
      setPricingMessage('Draft pricing version created.')
      await loadPricingData(activeClubId)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to create draft.')
    } finally {
      setPricingLoading(false)
    }
  }

  async function handleCreateDraftFromPublished() {
    if (!activeClubId) return
    setPricingLoading(true)
    setPricingMessage(null)
    setPricingValidation(null)
    try {
      const createResponse = await fetch(`/api/clubs/${activeClubId}/pricing/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const createPayload = (await createResponse.json()) as {
        id?: string
        error?: string
      }
      if (!createResponse.ok || !createPayload.id) {
        throw new Error(createPayload.error || 'Failed to create draft pricing version.')
      }
      const newDraftId = createPayload.id

      if (latestPublishedPricingVersion) {
        const publishedDetailResponse = await fetch(
          `/api/clubs/${activeClubId}/pricing/versions/${latestPublishedPricingVersion.id}`,
          { cache: 'no-store' },
        )
        const publishedDetailPayload = (await publishedDetailResponse.json()) as
          | PricingVersionDetail
          | { error?: string }
        if (!publishedDetailResponse.ok) {
          throw new Error(
            (publishedDetailPayload as { error?: string }).error ||
              'Failed to load published pricing rules.',
          )
        }
        const publishedDetail = publishedDetailPayload as PricingVersionDetail

        const cloneResponse = await fetch(`/api/pricing/versions/${newDraftId}/rules`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rules: (publishedDetail.rules || []).map(pricingRuleRecordToInput),
          }),
        })
        const clonePayload = (await cloneResponse.json()) as { error?: string; details?: string[] }
        if (!cloneResponse.ok) {
          throw new Error(clonePayload.error || clonePayload.details?.[0] || 'Failed to clone pricing rules.')
        }
      }

      await loadPricingData(activeClubId)
      setSelectedPricingDraftId(newDraftId)
      await loadPricingVersionDetail(activeClubId, newDraftId)
      setPricingMessage(
        latestPublishedPricingVersion
          ? 'Draft created from published pricing version.'
          : 'Draft pricing version created.',
      )
    } catch (error) {
      setPricingMessage(
        error instanceof Error ? error.message : 'Failed to create draft from published version.',
      )
    } finally {
      setPricingLoading(false)
    }
  }

  async function handlePublishPricingVersion(versionId: string) {
    if (!activeClubId) return
    setPricingLoading(true)
    setPublishingVersionId(versionId)
    setPricingMessage(null)
    setPricingValidation(null)
    try {
      const response = await fetch(
        `/api/clubs/${activeClubId}/pricing/versions/${versionId}/publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const payload = (await response.json()) as {
        code?: string
        error?: string
        details?: Record<string, string[]>
      }
      if (!response.ok) {
        if (payload.code === 'PRICING_PUBLISH_BLOCKED' && payload.details) {
          setPricingValidation(payload.details)
        }
        throw new Error(payload.error || 'Failed to publish pricing version.')
      }
      setPricingMessage('Pricing version published.')
      await loadPricingData(activeClubId)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to publish pricing version.')
    } finally {
      setPricingLoading(false)
      setPublishingVersionId(null)
    }
  }

  async function handleSaveSegmentBaseRates() {
    if (!activeClubId || !selectedPricingDraftId || !selectedPricingVersionDetail) return
    setPricingRulesBusy(true)
    setPricingMessage(null)
    setPricingValidation(null)

    try {
      const editableSegmentIds = new Set(segments.map((segment) => segment.id))
      const preservedRules = (selectedPricingVersionDetail.rules || []).filter(
        (rule) =>
          !(
            rule.ruleType === 'BASE_RATE' &&
            rule.scopeType === 'SEGMENT' &&
            editableSegmentIds.has(String(rule.scopeId))
          ),
      )

      const nextBaseRules = segments
        .map((segment) => {
          const raw = (segmentBaseRates[segment.id] || '').trim()
          if (!raw) return null
          const parsed = Number(raw)
          if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`Invalid rate for segment "${segment.name}". Use a non-negative integer (KZT/hour).`)
          }

          const existing = (selectedPricingVersionDetail.rules || []).find(
            (rule) =>
              rule.ruleType === 'BASE_RATE' &&
              rule.scopeType === 'SEGMENT' &&
              String(rule.scopeId) === segment.id,
          )

          return {
            ruleType: 'BASE_RATE',
            priority: existing?.priority ?? 10,
            scopeType: 'SEGMENT' as const,
            scopeId: segment.id,
            setRatePerHourCents: parsed,
            channel: typeof existing?.channel === 'string' ? existing.channel : undefined,
            customerType: typeof existing?.customerType === 'string' ? existing.customerType : undefined,
            exclusive: existing?.exclusive === true,
            label:
              typeof existing?.label === 'string' && existing.label.trim()
                ? existing.label
                : `${segment.name} base`,
          }
        })
        .filter((rule): rule is NonNullable<typeof rule> => rule !== null)

      const payloadRules: PricingRuleInput[] = [
        ...preservedRules.map(pricingRuleRecordToInput),
        ...nextBaseRules,
      ]

      const response = await fetch(`/api/pricing/versions/${selectedPricingDraftId}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: payloadRules }),
      })
      const payload = (await response.json()) as { error?: string; details?: string[] }
      if (!response.ok) {
        throw new Error(
          payload.error || payload.details?.[0] || 'Failed to save pricing rules.',
        )
      }

      setPricingMessage('Segment base rates saved to draft pricing version.')
      await Promise.all([loadPricingVersionDetail(activeClubId, selectedPricingDraftId), loadPricingData(activeClubId)])
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to save segment pricing rates.')
    } finally {
      setPricingRulesBusy(false)
    }
  }

  async function handlePreviewQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId || !quoteForm.roomId) return

    setPricingLoading(true)
    setPricingMessage(null)
    setPricingValidation(null)
    setQuoteResult(null)
    try {
      const response = await fetch('/api/pricing/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clubId: activeClubId,
          roomId: Number(quoteForm.roomId),
          packageId: quoteForm.packageId || undefined,
          promoCode: quoteForm.promoCode || undefined,
          startAt: new Date(quoteForm.startAt).toISOString(),
          endAt: new Date(quoteForm.endAt).toISOString(),
          channel: 'ONLINE',
          customerType: 'GUEST',
        }),
      })
      const payload = (await response.json()) as QuoteResponse | { error?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to generate quote.')
      }
      setQuoteResult(payload as QuoteResponse)
    } catch (error) {
      setPricingMessage(error instanceof Error ? error.message : 'Failed to generate quote.')
    } finally {
      setPricingLoading(false)
    }
  }

  async function handleInitializeMap() {
    if (!activeClubId) return

    setMapBusy(true)
    setMapError(null)
    setMapMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/maps`, {
        method: 'POST',
      })
      const payload = (await response.json()) as MapDraftResponse | unknown
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, 'Failed to initialize map draft.'))
      }

      const draftPayload = payload as MapDraftResponse
      const nextDraftText = JSON.stringify(draftPayload.draft, null, 2)
      setMapMetadata({
        mapId: draftPayload.mapId,
        createdAt: draftPayload.createdAt,
        updatedAt: draftPayload.updatedAt,
        updatedByUserId: null,
      })
      setMapDraftRevision(draftPayload.draftRevision)
      setMapDraftText(nextDraftText)
      setMapLoadedSnapshot(nextDraftText)
      setMapPublishResult(null)
      setMapPublishPreview(null)
      setMapMessage('Map draft initialized.')
      await loadMapVersions(activeClubId)
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Failed to initialize map draft.')
    } finally {
      setMapBusy(false)
    }
  }

  async function handleReloadMapEditor() {
    if (!activeClubId) return
    setMapPublishResult(null)
    setMapPublishPreview(null)
    await loadMapEditorData(activeClubId)
  }

  function handleFormatMapDraft() {
    if (!mapDraftText.trim()) return
    setMapError(null)
    try {
      const parsed = JSON.parse(mapDraftText) as unknown
      setMapDraftText(JSON.stringify(parsed, null, 2))
      setMapMessage('Draft JSON formatted.')
    } catch {
      setMapError('Draft JSON is not valid. Fix syntax before formatting.')
    }
  }

  async function handleSaveMapDraft() {
    if (!activeClubId || mapDraftRevision == null) return

    setMapBusy(true)
    setMapError(null)
    setMapMessage(null)
    try {
      const parsedDraft = JSON.parse(mapDraftText) as unknown

      const response = await fetch(`/api/clubs/${activeClubId}/map/draft`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${mapDraftRevision}"`,
        },
        body: JSON.stringify({ draft: parsedDraft }),
      })

      const payload = (await response.json()) as MapDraftResponse | unknown
      if (!response.ok) {
        if (response.status === 409 || response.status === 428) {
          await loadMapDraft(activeClubId)
          throw new Error('Draft revision changed on server. Latest draft loaded, then re-apply edits.')
        }
        throw new Error(errorMessageFromPayload(payload, 'Failed to save map draft.'))
      }

      const draftPayload = payload as MapDraftResponse
      const warnings = warningsFromPayload(payload)
      const nextDraftText = JSON.stringify(draftPayload.draft, null, 2)

      setMapMetadata({
        mapId: draftPayload.mapId,
        createdAt: draftPayload.createdAt,
        updatedAt: draftPayload.updatedAt,
        updatedByUserId: draftPayload.updatedByUserId,
      })
      setMapDraftRevision(
        parseRevisionFromEtag(response.headers.get('etag')) ?? draftPayload.draftRevision,
      )
      setMapDraftText(nextDraftText)
      setMapLoadedSnapshot(nextDraftText)
      setMapPublishResult(null)
      setMapPublishPreview(null)
      setMapMessage(
        warnings.length > 0 ? `Draft saved with warnings: ${warnings.join(' ')}` : 'Draft saved.',
      )
    } catch (error) {
      if (error instanceof SyntaxError) {
        setMapError('Draft JSON is invalid. Fix syntax before saving.')
      } else {
        setMapError(error instanceof Error ? error.message : 'Failed to save map draft.')
      }
    } finally {
      setMapBusy(false)
    }
  }

  async function handlePreviewMapPublish() {
    if (!activeClubId || !mapMetadata) return

    setMapPreviewLoading(true)
    setMapError(null)
    setMapMessage(null)
    try {
      const parsedDraft = JSON.parse(mapDraftText) as unknown
      const draftSeats = seatSnapshotsFromDraft(parsedDraft)
      const published = await loadLatestPublishedSeatSnapshots(activeClubId)

      const draftBySeatId = new Map(draftSeats.map((seat) => [seat.seatId, seat]))
      const publishedBySeatId = new Map(published.seats.map((seat) => [seat.seatId, seat]))

      const added: SeatSnapshot[] = []
      const updated: Array<{ before: SeatSnapshot; after: SeatSnapshot }> = []
      const removed: SeatSnapshot[] = []

      for (const seat of draftSeats) {
        const existing = publishedBySeatId.get(seat.seatId)
        if (!existing) {
          added.push(seat)
          continue
        }
        if (!seatsEqual(existing, seat)) {
          updated.push({
            before: existing,
            after: seat,
          })
        }
      }

      for (const seat of published.seats) {
        if (!draftBySeatId.has(seat.seatId)) {
          removed.push(seat)
        }
      }

      setMapPublishPreview({
        generatedAt: new Date().toISOString(),
        againstVersionNumber: published.versionNumber,
        added,
        removed,
        updated,
      })
      setMapMessage(
        `Preview ready: +${added.length} / -${removed.length} / ~${updated.length}.`,
      )
    } catch (error) {
      if (error instanceof SyntaxError) {
        setMapError('Draft JSON is invalid. Fix syntax before preview.')
      } else {
        setMapError(error instanceof Error ? error.message : 'Failed to preview publish changes.')
      }
    } finally {
      setMapPreviewLoading(false)
    }
  }

  async function handlePublishMapDraft() {
    if (!activeClubId || !mapMetadata) return

    setMapBusy(true)
    setMapError(null)
    setMapMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/map/publish`, {
        method: 'POST',
      })
      const payload = (await response.json()) as PublishResult | unknown
      if (!response.ok) {
        throw new Error(errorMessageFromPayload(payload, 'Failed to publish map version.'))
      }

      const result = payload as PublishResult
      setMapPublishResult(result)
      setMapPublishPreview(null)
      setMapMessage(
        `Published map version ${result.versionNumber}. Seats: ${result.seatCount}.`,
      )
      await Promise.all([loadMapDraft(activeClubId), loadMapVersions(activeClubId)])
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Failed to publish map version.')
    } finally {
      setMapBusy(false)
    }
  }

  async function handleSaveScheduleSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return

    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          businessHoursText: scheduleForm.businessHoursText || null,
        }),
      })
      const payload = await readJsonOrThrow<ClubDetailsResponse>(
        response,
        'Failed to save schedule settings.',
      )
      setClubDetails(payload)
      setScheduleForm((current) => ({
        ...current,
        slotsGeneratedUntil: toDateTimeLocalValue(payload.slotsGeneratedUntil),
        businessHoursText: payload.businessHoursText || '',
      }))
      setAdminMessage('Schedule display settings saved.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to save schedule settings.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleSaveScheduleTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return

    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const slotDurationMinutes = Number(scheduleTemplateForm.slotDurationMinutes)
      const bookingLeadTimeMinutes = Number(scheduleTemplateForm.bookingLeadTimeMinutes)
      const maxAdvanceDays = Number(scheduleTemplateForm.maxAdvanceDays)

      const weeklyHours = WEEKDAY_ORDER.reduce<
        Record<
          WeekdayKey,
          {
            closed: boolean
            openTime: string | null
            closeTime: string | null
          }
        >
      >((accumulator, day) => {
        const config = scheduleTemplateForm.weeklyHours[day]
        accumulator[day] = {
          closed: config.closed,
          openTime: config.closed ? null : config.openTime,
          closeTime: config.closed ? null : config.closeTime,
        }
        return accumulator
      }, {} as Record<WeekdayKey, { closed: boolean; openTime: string | null; closeTime: string | null }>)

      const response = await fetch(`/api/clubs/${activeClubId}/schedule/template`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slotDurationMinutes,
          bookingLeadTimeMinutes,
          maxAdvanceDays,
          weeklyHours,
          effectiveFrom: fromDateTimeLocalValue(scheduleTemplateForm.effectiveFrom),
        }),
      })

      const payload = await readJsonOrThrow<ScheduleTemplateResponse>(
        response,
        'Failed to save schedule template.',
      )

      setScheduleTemplateExists(payload.exists)
      setScheduleTemplateRevision(payload.template.revision)
      setScheduleTemplateUpdatedAt(payload.template.updatedAt)
      setScheduleTemplateForm({
        slotDurationMinutes: String(payload.template.slotDurationMinutes),
        bookingLeadTimeMinutes: String(payload.template.bookingLeadTimeMinutes),
        maxAdvanceDays: String(payload.template.maxAdvanceDays),
        effectiveFrom: toDateTimeLocalValue(payload.template.effectiveFrom),
        weeklyHours: normalizeWeeklyHoursForForm(payload.template.weeklyHours),
      })
      setScheduleForm((current) => ({
        ...current,
        horizonDays: String(payload.template.maxAdvanceDays),
      }))
      setAdminMessage('Schedule template saved.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to save schedule template.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleCreateScheduleException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return

    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const startAt = fromDateTimeLocalValue(scheduleExceptionForm.startAt)
      const endAt = fromDateTimeLocalValue(scheduleExceptionForm.endAt)
      if (!startAt || !endAt) {
        throw new Error('Exception start/end must be valid datetimes.')
      }

      const response = await fetch(`/api/clubs/${activeClubId}/schedule/exceptions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: scheduleExceptionForm.type,
          startAt,
          endAt,
          reason: scheduleExceptionForm.reason || null,
        }),
      })
      await readJsonOrThrow(response, 'Failed to create schedule exception.')

      setScheduleExceptionForm((current) => ({
        ...current,
        reason: '',
      }))
      await loadScheduleData(activeClubId)
      setAdminMessage('Schedule exception added.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to create schedule exception.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleDeleteScheduleException(exceptionId: string) {
    if (!activeClubId) return
    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const response = await fetch(
        `/api/clubs/${activeClubId}/schedule/exceptions/${exceptionId}`,
        {
          method: 'DELETE',
        },
      )
      await readJsonOrThrow(response, 'Failed to delete schedule exception.')
      await loadScheduleData(activeClubId)
      setAdminMessage('Schedule exception deleted.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to delete schedule exception.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handlePublishSchedule() {
    if (!activeClubId) return
    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    setSchedulePublishResult(null)
    try {
      const horizonDays = Number(scheduleForm.horizonDays)
      const response = await fetch(`/api/clubs/${activeClubId}/schedule/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          horizonDays,
        }),
      })
      const payload = await readJsonOrThrow<SchedulePublishResponse>(
        response,
        'Failed to publish schedule.',
      )

      setSchedulePublishResult(payload)
      setScheduleForm((current) => ({
        ...current,
        slotsGeneratedUntil: toDateTimeLocalValue(payload.slotsGeneratedUntil),
      }))
      setClubDetails((current) =>
        current
          ? {
              ...current,
              schedulePublishedAt: payload.schedulePublishedAt,
              slotsGeneratedUntil: payload.slotsGeneratedUntil,
            }
          : current,
      )
      await Promise.all([
        loadScheduleData(activeClubId),
        loadAuditEntries(activeClubId, {
          action: auditFilters.action || undefined,
          entityType: auditFilters.entityType || undefined,
          dateFrom: auditFilters.dateFrom || undefined,
          dateTo: auditFilters.dateTo || undefined,
        }),
      ])
      setAdminMessage('Schedule published and slots regenerated.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to publish schedule.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleRefreshSchedulePreview() {
    if (!activeClubId) return
    setAdminBusy(true)
    setAdminError(null)
    try {
      await loadSchedulePreviewSlots(activeClubId, scheduleForm.previewDate)
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to refresh slots preview.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleSavePolicies(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return

    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const holdTtlMinutes = Number(policyForm.holdTtlMinutes)
      if (!Number.isInteger(holdTtlMinutes) || holdTtlMinutes < 1) {
        throw new Error('Hold TTL must be a positive integer.')
      }

      const cancellationPolicy = JSON.parse(policyForm.cancellationPolicyJson) as Record<string, unknown>
      const checkInPolicy = JSON.parse(policyForm.checkInPolicyJson) as Record<string, unknown>

      const response = await fetch(`/api/clubs/${activeClubId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          holdTtlMinutes,
          cancellationPolicy,
          checkInPolicy,
        }),
      })

      const payload = await readJsonOrThrow<ClubDetailsResponse>(
        response,
        'Failed to save policies.',
      )
      setClubDetails(payload)
      setPolicyForm({
        holdTtlMinutes: String(payload.holdTtlMinutes ?? holdTtlMinutes),
        cancellationPolicyJson: JSON.stringify(payload.cancellationPolicy ?? {}, null, 2),
        checkInPolicyJson: JSON.stringify(payload.checkInPolicy ?? {}, null, 2),
      })
      setAdminMessage('Policies saved.')
    } catch (error) {
      if (error instanceof SyntaxError) {
        setAdminError('Policy JSON is invalid.')
      } else {
        setAdminError(error instanceof Error ? error.message : 'Failed to save policies.')
      }
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleAssignMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return

    setAdminBusy(true)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/members/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: staffForm.email,
          role: staffForm.role,
        }),
      })
      await readJsonOrThrow(response, 'Failed to assign member.')
      setStaffForm((current) => ({ ...current, email: '' }))
      await loadClubAdminData(activeClubId)
      setAdminMessage('Member assigned.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to assign member.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleUpdateMember(
    membershipId: string,
    updates: { role?: Role; status?: 'ACTIVE' | 'INVITED' | 'DISABLED' },
  ) {
    if (!activeClubId) return
    setMemberBusyId(membershipId)
    setAdminError(null)
    setAdminMessage(null)
    try {
      const response = await fetch(
        `/api/clubs/${activeClubId}/members/by-membership/${membershipId}`,
        {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
        },
      )
      await readJsonOrThrow(response, 'Failed to update member.')
      await loadClubAdminData(activeClubId)
      setAdminMessage('Member updated.')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to update member.')
    } finally {
      setMemberBusyId(null)
    }
  }

  async function handleReloadAuditWithFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeClubId) return
    setAdminBusy(true)
    setAdminError(null)
    try {
      await loadAuditEntries(activeClubId, {
        action: auditFilters.action || undefined,
        entityType: auditFilters.entityType || undefined,
        dateFrom: auditFilters.dateFrom || undefined,
        dateTo: auditFilters.dateTo || undefined,
      })
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Failed to load audit.')
    } finally {
      setAdminBusy(false)
    }
  }

  if (!knownSections.has(section)) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Access denied</h2>
        <p className="text-sm text-[var(--muted)]">
          This technical admin section is unavailable for your current capabilities.
        </p>
      </div>
    )
  }

  if (section === 'onboarding') {
    return <OnboardingSection />
  }

  if (section === 'account') {
    return (
      <AccountSettingsSection
        heading="Club Owner Account"
        subtitle="Manage your login, personal info, phone/email verification, and password."
      />
    )
  }

  if (section === 'map-editor') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Map Editor</h2>
        <p className="text-sm text-[var(--muted)]">
          Create and update seat maps with a simple WYSIWYG editor, then save draft revisions and publish versioned map snapshots.
        </p>

        {mapError ? (
          <div className="panel-strong border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
            {mapError}
          </div>
        ) : null}
        {mapMessage ? (
          <div className="panel-strong border-emerald-400/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            {mapMessage}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {mapMetadata ? (
            <>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={() => void handleReloadMapEditor()}
                disabled={mapLoading || mapBusy}
              >
                {mapLoading ? 'Refreshing...' : 'Refresh Draft'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={() => void handleSaveMapDraft()}
                disabled={mapBusy || mapLoading || mapDraftRevision == null}
              >
                {mapBusy ? 'Working...' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={() => void handlePreviewMapPublish()}
                disabled={mapBusy || mapLoading || mapPreviewLoading || !mapDraftText}
              >
                {mapPreviewLoading ? 'Previewing...' : 'Preview Changes'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                onClick={() => void handlePublishMapDraft()}
                disabled={mapBusy || mapLoading || mapDraftDirty}
              >
                Publish Draft
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              onClick={() => void handleInitializeMap()}
              disabled={mapBusy || mapLoading || !activeClubId}
            >
              {mapBusy ? 'Creating...' : 'Initialize Draft Map'}
            </button>
          )}
        </div>

        {!mapMetadata ? (
          <article className="panel-strong p-4 text-sm text-[var(--muted)]">
            No draft map exists for this club. Initialize one to begin.
          </article>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <article className="panel-strong p-3">
                <p className="text-xs text-[var(--muted)]">Draft Revision</p>
                <p className="text-xl font-semibold">{mapDraftRevision ?? 'n/a'}</p>
              </article>
              <article className="panel-strong p-3">
                <p className="text-xs text-[var(--muted)]">Draft Seats</p>
                <p className="text-xl font-semibold">{mapStats.seats}</p>
              </article>
              <article className="panel-strong p-3">
                <p className="text-xs text-[var(--muted)]">Floors / Rooms / Walls</p>
                <p className="text-xl font-semibold">
                  {mapStats.floors} / {mapStats.rooms} / {mapStats.walls}
                </p>
              </article>
            </div>

            <article className="panel-strong p-3 text-xs text-[var(--muted)]">
              <p>Map ID: {mapMetadata.mapId}</p>
              <p>Updated: {new Date(mapMetadata.updatedAt).toLocaleString()}</p>
              {mapMetadata.updatedByUserId ? (
                <p>Updated by: {mapMetadata.updatedByUserId}</p>
              ) : null}
              {mapDraftDirty ? (
                <p className="mt-2 text-amber-600 dark:text-amber-300">
                  Unsaved draft changes. Save before publish.
                </p>
              ) : null}
              {mapStats.parseError ? (
                <p className="mt-2 text-red-600 dark:text-red-300">{mapStats.parseError}</p>
              ) : null}
              {segments.length === 0 ? (
                <p className="mt-2 text-amber-600 dark:text-amber-300">
                  No active segments found. Publishing requires segmentId on every seat.
                </p>
              ) : null}
            </article>

            <SimpleSeatMapEditor
              draftText={mapDraftText}
              onDraftTextChange={(next) => {
                setMapDraftText(next)
                setMapPublishPreview(null)
              }}
              segments={segments}
              disabled={mapBusy || mapLoading}
            />
          </>
        )}

        {mapPublishPreview ? (
          <article className="panel-strong space-y-2 p-4">
            <p className="text-sm font-medium">Publish Preview</p>
            <p className="text-xs text-[var(--muted)]">
              Compared with published version{' '}
              {mapPublishPreview.againstVersionNumber ?? 'none'} at{' '}
              {new Date(mapPublishPreview.generatedAt).toLocaleString()}
            </p>
            <p className="text-sm">
              +{mapPublishPreview.added.length} to add / -{mapPublishPreview.removed.length} to remove / ~
              {mapPublishPreview.updated.length} to update
            </p>

            {mapPublishPreview.added.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted)]">Seats to be added</p>
                <div className="max-h-52 space-y-1 overflow-auto">
                  {mapPublishPreview.added.map((seat) => (
                    <p key={seat.seatId} className="text-xs">
                      {seat.label} ({seat.seatId}) · segment {seat.segmentId || '-'} · type{' '}
                      {seat.seatType} · {seat.isDisabled ? 'DISABLED' : 'ACTIVE'}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)]">No new seats will be added.</p>
            )}
          </article>
        ) : null}

        {mapPublishResult ? (
          <article className="panel-strong space-y-2 p-4">
            <p className="text-sm font-medium">Last Publish Result</p>
            <p className="text-sm">
              Version {mapPublishResult.versionNumber} · Seats {mapPublishResult.seatCount}
            </p>
            {mapPublishResult.diffSummary ? (
              <p className="text-xs text-[var(--muted)]">
                Diff: +{mapPublishResult.diffSummary.added} / -{mapPublishResult.diffSummary.removed}{' '}
                / ~{mapPublishResult.diffSummary.updated} / toggled disabled{' '}
                {mapPublishResult.diffSummary.disabledChanged ?? 0}
              </p>
            ) : null}
            {mapPublishResult.seatCountByFloor && mapPublishResult.seatCountByFloor.length > 0 ? (
              <div className="space-y-1 text-xs text-[var(--muted)]">
                {mapPublishResult.seatCountByFloor.map((item) => (
                  <p key={item.floorId}>
                    {item.floorId}: {item.seatCount} seats
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Published Versions</h3>
          {mapVersions.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No published map versions yet.</p>
          ) : (
            mapVersions.map((version) => (
              <article key={version.id} className="panel-strong p-3 text-sm">
                <p className="font-medium">Version {version.versionNumber}</p>
                <p className="text-xs text-[var(--muted)]">
                  Seats: {version.seatCount} · Published {new Date(version.publishedAt).toLocaleString()}
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    )
  }

  if (section === 'pricing') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Segments & Pricing</h2>

        <div className="grid gap-3 md:grid-cols-3">
          <article className="panel-strong p-3">
            <p className="text-xs text-[var(--muted)]">Segments</p>
            <p className="text-xl font-semibold">{segments.length}</p>
          </article>
          <article className="panel-strong p-3">
            <p className="text-xs text-[var(--muted)]">Packages</p>
            <p className="text-xl font-semibold">{packages.length}</p>
          </article>
          <article className="panel-strong p-3">
            <p className="text-xs text-[var(--muted)]">Pricing Versions</p>
            <p className="text-xl font-semibold">{pricingVersions.length}</p>
          </article>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            onClick={() => void handleCreateDraftVersion()}
            disabled={!activeClubId || pricingLoading}
          >
            {pricingLoading ? 'Working...' : 'Create Draft Version'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            onClick={() => void handleCreateDraftFromPublished()}
            disabled={!activeClubId || pricingLoading || !latestPublishedPricingVersion}
          >
            {pricingLoading ? 'Working...' : 'Create Draft from Published'}
          </button>
          {pricingMessage ? <span className="text-sm text-[var(--muted)]">{pricingMessage}</span> : null}
        </div>

        {pricingValidation ? (
          <article className="panel-strong space-y-2 p-4">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Publish blocked by validation rules
            </p>
            <div className="space-y-2 text-sm">
              {Object.entries(pricingValidation).map(([blocker, messages]) =>
                messages.length > 0 ? (
                  <div key={blocker} className="space-y-1">
                    <p className="font-medium">{blocker}</p>
                    {messages.map((message, index) => (
                      <p key={`${blocker}-${index}`} className="text-xs text-[var(--muted)]">
                        {message}
                      </p>
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          </article>
        ) : null}

        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Pricing Versions</h3>
          {pricingVersions.length < 1 ? (
            <p className="text-sm text-[var(--muted)]">No pricing versions yet.</p>
          ) : (
            <div className="space-y-2">
              {pricingVersions.map((version) => (
                <div
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      Version {version.versionNumber} · {version.status}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      Effective: {new Date(version.effectiveFrom).toLocaleString()} -{' '}
                      {version.effectiveTo ? new Date(version.effectiveTo).toLocaleString() : 'open-ended'}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      Rules: {version._count?.rules ?? 0}
                      {version.publishedAt
                        ? ` · Published ${new Date(version.publishedAt).toLocaleString()}`
                        : ''}
                    </p>
                  </div>
                  {version.status === 'DRAFT' ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                      onClick={() => void handlePublishPricingVersion(version.id)}
                      disabled={pricingLoading}
                    >
                      {pricingLoading && publishingVersionId === version.id
                        ? 'Publishing...'
                        : 'Publish'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel-strong space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Segment Base Rates (Draft Editor)</h3>
              <p className="text-xs text-[var(--muted)]">
                Set base hourly rates per segment (e.g. Standard, Bootcamp). Time modifiers and room overrides are preserved.
              </p>
            </div>
            <div className="text-right text-xs text-[var(--muted)]">
              <p>Configured segments: {segmentRateCoverage.configured}/{segmentRateCoverage.total}</p>
              {segmentRateCoverage.missing > 0 ? (
                <p className="text-amber-700 dark:text-amber-300">
                  Missing rates: {segmentRateCoverage.missing}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm font-medium">Segments</p>
            <div className="flex flex-wrap gap-2">
              <form className="flex flex-1 flex-wrap gap-2" onSubmit={handleCreateSegment}>
                <input
                  className="panel min-w-[220px] flex-1 rounded-lg px-3 py-2 text-sm"
                  value={segmentForm.name}
                  onChange={(event) =>
                    setSegmentForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="New segment name"
                  disabled={segmentBusy || !activeClubId}
                />
                <button
                  type="submit"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                  disabled={segmentBusy || !activeClubId}
                >
                  {segmentBusy ? 'Saving...' : 'Add Segment'}
                </button>
              </form>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                onClick={() => void handleCreateDefaultSegments()}
                disabled={segmentBusy || !activeClubId}
              >
                Add Standard/Bootcamp/VIP
              </button>
            </div>

            {segments.length > 0 ? (
              <div className="space-y-2">
                {segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{segment.name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {segment.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      onClick={() => void handleToggleSegment(segment)}
                      disabled={segmentBusy || !activeClubId}
                    >
                      {segment.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                No segments configured for this club yet.
              </p>
            )}
          </div>

          {draftPricingVersions.length < 1 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
              Create a draft pricing version first, then set segment rates here.
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Draft Version
                <select
                  className="panel rounded-lg px-3 py-2"
                  value={selectedPricingDraftId}
                  onChange={(event) => setSelectedPricingDraftId(event.target.value)}
                >
                  {draftPricingVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      Version {version.versionNumber} · Draft · Rules {version._count?.rules ?? 0}
                    </option>
                  ))}
                </select>
              </label>

              {!selectedPricingVersionDetail || selectedPricingVersionDetail.id !== selectedPricingDraftId ? (
                <p className="text-sm text-[var(--muted)]">Loading pricing rules for selected draft...</p>
              ) : segments.length < 1 ? (
                <p className="text-sm text-[var(--muted)]">
                  No segments found yet. Create segments above, then assign them in Map Editor.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {segments.map((segment) => (
                      <label key={segment.id} className="panel flex flex-col gap-1 rounded-lg p-3 text-sm">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{segment.name}</span>
                          <span className="text-xs text-[var(--muted)]">
                            {segment.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </span>
                        <span className="text-xs text-[var(--muted)]">Base rate per hour (KZT). Example: 500</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="panel rounded-lg px-3 py-2"
                          value={segmentBaseRates[segment.id] ?? ''}
                          onChange={(event) =>
                            setSegmentBaseRates((current) => ({
                              ...current,
                              [segment.id]: event.target.value,
                            }))
                          }
                          placeholder="e.g. 500"
                        />
                        <span className="text-xs text-[var(--muted)]">
                          {(() => {
                            const raw = (segmentBaseRates[segment.id] || '').trim()
                            const amount = Number(raw)
                            if (!raw || !Number.isFinite(amount)) return 'Unset'
                            return `≈ ${Math.trunc(amount)} KZT / hour`
                          })()}
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                      onClick={() => void handleSaveSegmentBaseRates()}
                      disabled={pricingRulesBusy || pricingLoading || !selectedPricingDraftVersion}
                    >
                      {pricingRulesBusy ? 'Saving Rates...' : 'Save Segment Rates'}
                    </button>
                    <span className="text-xs text-[var(--muted)]">
                      Saves to draft version {selectedPricingDraftVersion?.versionNumber ?? '-'} only.
                    </span>
                  </div>
                </>
              )}
            </>
          )}
        </article>

        <form onSubmit={handlePreviewQuote} className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Pricing Preview Calculator</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Room
              <select
                className="panel rounded-lg px-3 py-2"
                value={quoteForm.roomId}
                onChange={(event) =>
                  setQuoteForm((current) => ({ ...current, roomId: event.target.value }))
                }
                required
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Package (optional)
              <select
                className="panel rounded-lg px-3 py-2"
                value={quoteForm.packageId}
                onChange={(event) =>
                  setQuoteForm((current) => ({ ...current, packageId: event.target.value }))
                }
              >
                <option value="">No package</option>
                {packages.map((pricingPackage) => (
                  <option key={pricingPackage.id} value={pricingPackage.id}>
                    {pricingPackage.name} ({pricingPackage.durationMinutes}m)
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Start
              <input
                className="panel rounded-lg px-3 py-2"
                type="datetime-local"
                value={quoteForm.startAt}
                onChange={(event) =>
                  setQuoteForm((current) => ({ ...current, startAt: event.target.value }))
                }
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              End
              <input
                className="panel rounded-lg px-3 py-2"
                type="datetime-local"
                value={quoteForm.endAt}
                onChange={(event) =>
                  setQuoteForm((current) => ({ ...current, endAt: event.target.value }))
                }
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Promo Code (optional)
            <input
              className="panel rounded-lg px-3 py-2"
              value={quoteForm.promoCode}
              onChange={(event) =>
                setQuoteForm((current) => ({ ...current, promoCode: event.target.value }))
              }
              placeholder="HAPPY500"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={pricingLoading || !activeClubId}
          >
            {pricingLoading ? 'Calculating...' : 'Preview Quote'}
          </button>
        </form>

        {quoteResult ? (
          <article className="panel-strong space-y-2 p-4">
            <p className="text-sm">
              Total: <span className="font-semibold">{formatMoney(quoteResult.total, quoteResult.currency)}</span>
            </p>
            {quoteResult.seat ? (
              <p className="text-xs text-[var(--muted)]">
                Seat: {quoteResult.seat.label} · Segment {quoteResult.seat.segmentId}
              </p>
            ) : null}
            {quoteResult.slot ? (
              <p className="text-xs text-[var(--muted)]">
                Slot: {new Date(quoteResult.slot.startAt).toLocaleString()} -{' '}
                {new Date(quoteResult.slot.endAt).toLocaleString()}
              </p>
            ) : null}
            <p className="text-xs text-[var(--muted)]">
              Pricing Version: {quoteResult.pricingVersionId} · Valid until{' '}
              {new Date(quoteResult.validUntil).toLocaleString()}
            </p>
            <div className="space-y-1">
              {quoteResult.breakdown.map((line, index) => (
                <p key={`${line.type}-${index}`} className="text-sm">
                  {line.label}: {line.amount < 0 ? '-' : ''}{formatMoney(Math.abs(line.amount), quoteResult.currency)}
                </p>
              ))}
            </div>
          </article>
        ) : null}
      </div>
    )
  }

  if (section === 'schedule') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Schedule & Slots</h2>
        <article className="panel-strong p-4 text-sm">
          <p className="font-medium">How to make slots bookable</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--muted)]">
            <li>Set weekly hours and slot rules in <span className="text-[var(--text)]">Schedule template</span>.</li>
            <li>Click <span className="text-[var(--text)]">Save template</span>.</li>
            <li>Click <span className="text-[var(--text)]">Publish schedule</span> to generate slots.</li>
            <li>Use <span className="text-[var(--text)]">Slots preview</span> to verify available slots for a date.</li>
          </ol>
          <p className="mt-2 text-xs text-[var(--muted)]">
            “Public display settings” only changes the informational business-hours text shown in UI.
          </p>
        </article>
        {adminError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{adminError}</p>
        ) : null}
        {adminMessage ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">{adminMessage}</p>
        ) : null}
        <article className="panel-strong grid gap-3 p-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--muted)]">Timezone</p>
            <p className="text-sm font-medium">{clubDetails?.timezone || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Template Revision</p>
            <p className="text-sm font-medium">{scheduleTemplateRevision || '-'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Schedule Published At</p>
            <p className="text-sm font-medium">
              {clubDetails?.schedulePublishedAt
                ? new Date(clubDetails.schedulePublishedAt).toLocaleString()
                : 'Not published'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Slots Generated Until</p>
            <p className="text-sm font-medium">
              {clubDetails?.slotsGeneratedUntil
                ? new Date(clubDetails.slotsGeneratedUntil).toLocaleString()
                : 'Not generated'}
            </p>
          </div>
          <div className="md:col-span-4">
            <p className="text-xs text-[var(--muted)]">
              Template exists: {scheduleTemplateExists ? 'yes' : 'no'}{' '}
              {scheduleTemplateUpdatedAt ? `· updated ${new Date(scheduleTemplateUpdatedAt).toLocaleString()}` : ''}
            </p>
          </div>
        </article>

        <form onSubmit={handleSaveScheduleSettings} className="panel-strong space-y-3 p-4">
          <p className="text-sm font-medium">Public display settings (informational only)</p>
          <label className="flex flex-col gap-1 text-sm">
            Display business hours (informational only)
            <input
              className="panel rounded-lg px-3 py-2"
              value={scheduleForm.businessHoursText}
              onChange={(event) =>
                setScheduleForm((current) => ({
                  ...current,
                  businessHoursText: event.target.value,
                }))
              }
              placeholder="Mon-Sun 10:00-23:00"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={adminBusy || !activeClubId}
          >
            {adminBusy ? 'Saving...' : 'Save public hours text'}
          </button>
        </form>

        <form onSubmit={handleSaveScheduleTemplate} className="panel-strong space-y-3 p-4">
          <p className="text-sm font-medium">Schedule template</p>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Slot duration (minutes)
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={15}
                max={720}
                step={15}
                value={scheduleTemplateForm.slotDurationMinutes}
                onChange={(event) =>
                  setScheduleTemplateForm((current) => ({
                    ...current,
                    slotDurationMinutes: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Booking lead time (minutes)
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={0}
                max={10080}
                value={scheduleTemplateForm.bookingLeadTimeMinutes}
                onChange={(event) =>
                  setScheduleTemplateForm((current) => ({
                    ...current,
                    bookingLeadTimeMinutes: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Max advance days
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={1}
                max={120}
                value={scheduleTemplateForm.maxAdvanceDays}
                onChange={(event) =>
                  setScheduleTemplateForm((current) => ({
                    ...current,
                    maxAdvanceDays: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Effective from (optional)
              <input
                className="panel rounded-lg px-3 py-2"
                type="datetime-local"
                value={scheduleTemplateForm.effectiveFrom}
                onChange={(event) =>
                  setScheduleTemplateForm((current) => ({
                    ...current,
                    effectiveFrom: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="space-y-2">
            {WEEKDAY_ORDER.map((day) => {
              const config = scheduleTemplateForm.weeklyHours[day]
              return (
                <div key={day} className="panel grid gap-2 rounded-lg p-2 md:grid-cols-[120px_auto_auto_auto] md:items-center">
                  <p className="text-sm font-medium">{WEEKDAY_LABEL[day]}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.closed}
                      onChange={(event) =>
                        setScheduleTemplateForm((current) => ({
                          ...current,
                          weeklyHours: {
                            ...current.weeklyHours,
                            [day]: {
                              ...current.weeklyHours[day],
                              closed: event.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    Closed
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    Open
                    <input
                      className="panel rounded-lg px-2 py-1 text-sm"
                      type="time"
                      value={config.openTime}
                      disabled={config.closed}
                      onChange={(event) =>
                        setScheduleTemplateForm((current) => ({
                          ...current,
                          weeklyHours: {
                            ...current.weeklyHours,
                            [day]: {
                              ...current.weeklyHours[day],
                              openTime: event.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    Close
                    <input
                      className="panel rounded-lg px-2 py-1 text-sm"
                      type="time"
                      value={config.closeTime}
                      disabled={config.closed}
                      onChange={(event) =>
                        setScheduleTemplateForm((current) => ({
                          ...current,
                          weeklyHours: {
                            ...current.weeklyHours,
                            [day]: {
                              ...current.weeklyHours[day],
                              closeTime: event.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              )
            })}
          </div>

          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={adminBusy || !activeClubId}
          >
            {adminBusy ? 'Saving...' : 'Save template'}
          </button>
        </form>

        <article className="panel-strong space-y-3 p-4">
          <p className="text-sm font-medium">Exceptions</p>
          <form onSubmit={handleCreateScheduleException} className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Type
              <select
                className="panel rounded-lg px-3 py-2"
                value={scheduleExceptionForm.type}
                onChange={(event) =>
                  setScheduleExceptionForm((current) => ({
                    ...current,
                    type: event.target.value as ScheduleExceptionItem['type'],
                  }))
                }
              >
                <option value="CLOSED_ALL_DAY">CLOSED_ALL_DAY</option>
                <option value="CLOSED_RANGE">CLOSED_RANGE</option>
                <option value="SPECIAL_HOURS">SPECIAL_HOURS</option>
                <option value="BLOCKED_RANGE">BLOCKED_RANGE</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Start
              <input
                className="panel rounded-lg px-3 py-2"
                type="datetime-local"
                value={scheduleExceptionForm.startAt}
                onChange={(event) =>
                  setScheduleExceptionForm((current) => ({
                    ...current,
                    startAt: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              End
              <input
                className="panel rounded-lg px-3 py-2"
                type="datetime-local"
                value={scheduleExceptionForm.endAt}
                onChange={(event) =>
                  setScheduleExceptionForm((current) => ({
                    ...current,
                    endAt: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Reason
              <input
                className="panel rounded-lg px-3 py-2"
                value={scheduleExceptionForm.reason}
                onChange={(event) =>
                  setScheduleExceptionForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Maintenance"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 md:col-span-4 md:justify-self-start"
              disabled={adminBusy || !activeClubId}
            >
              {adminBusy ? 'Adding...' : 'Add exception'}
            </button>
          </form>

          <div className="space-y-2">
            {scheduleExceptions.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No exceptions configured.</p>
            ) : (
              scheduleExceptions.map((exception) => (
                <article key={exception.id} className="panel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{exception.type}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {new Date(exception.startAt).toLocaleString()} -{' '}
                      {new Date(exception.endAt).toLocaleString()}
                    </p>
                    {exception.reason ? (
                      <p className="text-xs text-[var(--muted)]">{exception.reason}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                    disabled={adminBusy}
                    onClick={() => void handleDeleteScheduleException(exception.id)}
                  >
                    Delete
                  </button>
                </article>
              ))
            )}
          </div>
        </article>

        <article className="panel-strong space-y-3 p-4">
          <p className="text-sm font-medium">Generate & publish slots (operational step)</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Horizon days
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={1}
                max={120}
                value={scheduleForm.horizonDays}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    horizonDays: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
              onClick={() => void handlePublishSchedule()}
              disabled={adminBusy || !activeClubId}
            >
              {adminBusy ? 'Publishing...' : 'Publish schedule (generate slots)'}
            </button>
          </div>

          {schedulePublishResult ? (
            <div className="panel rounded-lg p-3 text-sm">
              <p className="text-xs text-[var(--muted)]">
                Published {new Date(schedulePublishResult.schedulePublishedAt).toLocaleString()} ·
                generated until {new Date(schedulePublishResult.slotsGeneratedUntil).toLocaleString()}
              </p>
              <p className="mt-1">
                created {schedulePublishResult.result.created} / updated {schedulePublishResult.result.updated}
                / blocked {schedulePublishResult.result.blocked} / locked {schedulePublishResult.result.locked}
                {typeof schedulePublishResult.result.deleted === 'number'
                  ? ` / deleted ${schedulePublishResult.result.deleted}`
                  : ''}
              </p>
            </div>
          ) : null}
        </article>

        <article className="panel-strong space-y-3 p-4">
          <p className="text-sm font-medium">Slots preview</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                className="panel rounded-lg px-3 py-2"
                type="date"
                value={scheduleForm.previewDate}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    previewDate: event.target.value,
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              disabled={adminBusy || !activeClubId || !scheduleForm.previewDate}
              onClick={() => void handleRefreshSchedulePreview()}
            >
              Refresh preview
            </button>
          </div>
          {schedulePreviewSlots.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No slots found for selected date.</p>
          ) : (
            <div className="space-y-1">
              {schedulePreviewSlots.map((slot) => (
                <article key={slot.slotId} className="panel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                  <p>
                    {new Date(slot.startAt).toLocaleTimeString()} -{' '}
                    {new Date(slot.endAt).toLocaleTimeString()}
                  </p>
                  <span
                    className={
                      slot.status === 'PUBLISHED'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : slot.status === 'BLOCKED'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-red-700 dark:text-red-300'
                    }
                  >
                    {slot.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </article>
      </div>
    )
  }

  if (section === 'staff') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Staff & Roles</h2>
        {adminError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{adminError}</p>
        ) : null}
        {adminMessage ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">{adminMessage}</p>
        ) : null}

        <form onSubmit={handleAssignMember} className="panel-strong grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="flex flex-col gap-1 text-sm">
            User email
            <input
              className="panel rounded-lg px-3 py-2"
              value={staffForm.email}
              onChange={(event) =>
                setStaffForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="host@example.com"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Role
            <select
              className="panel rounded-lg px-3 py-2"
              value={staffForm.role}
              onChange={(event) =>
                setStaffForm((current) => ({
                  ...current,
                  role: event.target.value as 'HOST_ADMIN' | 'TECH_ADMIN',
                }))
              }
            >
              <option value={Role.HOST_ADMIN}>HOST_ADMIN</option>
              <option value={Role.TECH_ADMIN}>TECH_ADMIN</option>
            </select>
          </label>
          <button
            type="submit"
            className="self-end rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={adminBusy || !activeClubId}
          >
            {adminBusy ? 'Working...' : 'Assign'}
          </button>
        </form>

        <div className="space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No members assigned yet.</p>
          ) : (
            members.map((member) => (
              <article key={member.id} className="panel-strong space-y-2 p-3 text-sm">
                <p className="font-medium">{member.user.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {member.user.email || member.user.phone || 'No contact'}
                </p>
                <p className="text-xs">
                  Role: {member.role} · Status: {member.status}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                    disabled={memberBusyId === member.id}
                    onClick={() =>
                      void handleUpdateMember(member.id, {
                        status: member.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
                      })
                    }
                  >
                    {member.status === 'ACTIVE' ? 'Disable' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                    disabled={memberBusyId === member.id}
                    onClick={() =>
                      void handleUpdateMember(member.id, {
                        role: member.role === Role.HOST_ADMIN ? Role.TECH_ADMIN : Role.HOST_ADMIN,
                      })
                    }
                  >
                    Switch to {member.role === Role.HOST_ADMIN ? 'TECH_ADMIN' : 'HOST_ADMIN'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    )
  }

  if (section === 'payments') {
    if (!activeClubId) {
      return (
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold">Payments</h2>
          <article className="panel-strong p-4 text-sm text-[var(--muted)]">
            Select an active club to view finance invoices and receipts.
          </article>
        </div>
      )
    }
    return <FinanceInvoicesSection activeClubId={activeClubId} />
  }

  if (section === 'finance') {
    if (!activeClubId) {
      return (
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold">Finance</h2>
          <article className="panel-strong p-4 text-sm text-[var(--muted)]">
            Select an active club to view owner analytics, cash shifts, liability, and forecast.
          </article>
        </div>
      )
    }
    return <FinanceAnalyticsSection activeClubId={activeClubId} />
  }

  if (section === 'policies') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Policies</h2>
        {adminError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{adminError}</p>
        ) : null}
        {adminMessage ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300">{adminMessage}</p>
        ) : null}
        <form onSubmit={handleSavePolicies} className="panel-strong space-y-3 p-4">
          <label className="flex flex-col gap-1 text-sm">
            Hold TTL (minutes)
            <input
              className="panel rounded-lg px-3 py-2"
              type="number"
              min={1}
              value={policyForm.holdTtlMinutes}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  holdTtlMinutes: event.target.value,
                }))
              }
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cancellation policy JSON
            <textarea
              className="panel min-h-[140px] rounded-lg px-3 py-2 font-mono text-xs"
              value={policyForm.cancellationPolicyJson}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  cancellationPolicyJson: event.target.value,
                }))
              }
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Check-in policy JSON
            <textarea
              className="panel min-h-[140px] rounded-lg px-3 py-2 font-mono text-xs"
              value={policyForm.checkInPolicyJson}
              onChange={(event) =>
                setPolicyForm((current) => ({
                  ...current,
                  checkInPolicyJson: event.target.value,
                }))
              }
              spellCheck={false}
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={adminBusy || !activeClubId}
          >
            {adminBusy ? 'Saving...' : 'Save policies'}
          </button>
        </form>
      </div>
    )
  }

  if (section === 'audit') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Audit Log</h2>
        {adminError ? (
          <p className="text-sm text-red-700 dark:text-red-300">{adminError}</p>
        ) : null}
        <form onSubmit={handleReloadAuditWithFilters} className="panel-strong grid gap-3 p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Action
            <input
              className="panel rounded-lg px-3 py-2"
              value={auditFilters.action}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, action: event.target.value }))
              }
              placeholder="booking.canceled"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Entity type
            <input
              className="panel rounded-lg px-3 py-2"
              value={auditFilters.entityType}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, entityType: event.target.value }))
              }
              placeholder="booking"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Date from
            <input
              className="panel rounded-lg px-3 py-2"
              type="datetime-local"
              value={auditFilters.dateFrom}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, dateFrom: event.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Date to
            <input
              className="panel rounded-lg px-3 py-2"
              type="datetime-local"
              value={auditFilters.dateTo}
              onChange={(event) =>
                setAuditFilters((current) => ({ ...current, dateTo: event.target.value }))
              }
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 md:col-span-2 md:justify-self-start"
            disabled={adminBusy || !activeClubId}
          >
            {adminBusy ? 'Loading...' : 'Apply filters'}
          </button>
        </form>

        <p className="text-sm text-[var(--muted)]">Operational bookings tracked: {bookingsCount}</p>
        {auditItems.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No audit entries yet for current filters.</p>
        ) : (
          <div className="space-y-2">
            {auditItems.map((item) => (
              <article key={item.id} className="panel-strong p-3 text-sm">
                <p className="font-medium">{item.action}</p>
                <p className="text-xs text-[var(--muted)]">
                  {item.entityType} #{item.entityId} · {new Date(item.createdAt).toLocaleString()}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Actor: {item.actor?.name || 'System'}
                </p>
                {item.metadata ? (
                  <pre className="mt-2 overflow-auto rounded bg-black/20 p-2 text-[10px]">
                    {item.metadata}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Club Overview</h2>
      {loading ? <p className="text-sm text-[var(--muted)]">Loading...</p> : null}
      {adminError ? (
        <p className="text-sm text-red-700 dark:text-red-300">{adminError}</p>
      ) : null}
      {adminMessage ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300">{adminMessage}</p>
      ) : null}
      {clubDetails ? (
        <article className="panel-strong p-3 text-sm">
          <p className="font-medium">{clubDetails.name}</p>
          <p className="text-xs text-[var(--muted)]">
            Status: {clubDetails.status} · Timezone: {clubDetails.timezone} · Currency:{' '}
            {clubDetails.currency}
          </p>
        </article>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {checklist.map((item) => (
          <article key={item.label} className="panel-strong p-3">
            <p className="text-sm">{item.label}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{item.done ? 'Done' : 'Pending'}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
