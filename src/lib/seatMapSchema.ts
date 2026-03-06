import { MapSeatType } from '@prisma/client'

type JsonRecord = Record<string, unknown>
export const CURRENT_SEAT_MAP_SCHEMA_VERSION = 2

type RectShape = {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

type PolylineShape = {
  type: 'polyline'
  points: Array<[number, number]>
  thickness?: number
}

export type SeatMapRoom = {
  roomId: string
  name: string
  roomType?: string
  shape: RectShape
}

export type SeatMapSeatElement = {
  id: string
  type: 'seat'
  seatId: string
  label: string
  segmentId?: string
  roomId?: string
  seatType?: string
  isDisabled?: boolean
  disableReason?: string
  shape: RectShape
}

export type SeatMapWallElement = {
  id: string
  type: 'wall'
  shape: PolylineShape
}

export type SeatMapElement = SeatMapSeatElement | SeatMapWallElement

export type SeatMapFloor = {
  floorId: string
  name: string
  plane: {
    width: number
    height: number
  }
  background?: {
    type: 'image'
    url: string
    width: number
    height: number
    opacity?: number
  }
  rooms: SeatMapRoom[]
  elements: SeatMapElement[]
}

export type SeatMapDocument = {
  schemaVersion: number
  mapId: string
  version: number
  floors: SeatMapFloor[]
}

export type SeatIndexInput = {
  seatId: string
  floorId: string
  roomId: string | null
  segmentId: string
  label: string
  seatType: MapSeatType
  geometry: RectShape
  isDisabled: boolean
  disabledReason: string | null
}

type ValidationMode = 'draft' | 'publish'

export type SeatMapValidationResult = {
  errors: string[]
  warnings: string[]
  document: SeatMapDocument | null
  seatIndexInputs: SeatIndexInput[]
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') return null
  return value
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseSchemaVersion(value: unknown) {
  const parsed = asNumber(value)
  if (parsed == null) return null
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

function cloneJsonRecord(value: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(value)) as JsonRecord
}

function migrateLegacyMapDocument(input: JsonRecord, warnings: string[]) {
  const root = cloneJsonRecord(input)
  const currentSchema = parseSchemaVersion(root.schemaVersion) ?? 1

  if (root.schemaVersion == null) {
    warnings.push(
      `Map schemaVersion was missing. Migrated draft to v${CURRENT_SEAT_MAP_SCHEMA_VERSION}.`,
    )
  }

  if (!Array.isArray(root.floors)) {
    root.schemaVersion = Math.max(currentSchema, CURRENT_SEAT_MAP_SCHEMA_VERSION)
    return root
  }

  if (currentSchema <= 1) {
    for (const floor of root.floors) {
      const floorRecord = asRecord(floor)
      if (!floorRecord || !Array.isArray(floorRecord.elements)) continue
      for (const element of floorRecord.elements) {
        const elementRecord = asRecord(element)
        if (!elementRecord || elementRecord.type !== 'seat') continue
        if (elementRecord.isDisabled === undefined) {
          elementRecord.isDisabled = false
        }
        if (elementRecord.disableReason !== undefined && typeof elementRecord.disableReason !== 'string') {
          elementRecord.disableReason = String(elementRecord.disableReason)
        }
      }
    }
  }

  root.schemaVersion = Math.max(currentSchema, CURRENT_SEAT_MAP_SCHEMA_VERSION)
  return root
}

function parseMapSeatType(value: string | undefined): MapSeatType {
  if (value === MapSeatType.PC) return MapSeatType.PC
  if (value === MapSeatType.CONSOLE) return MapSeatType.CONSOLE
  if (value === MapSeatType.VR) return MapSeatType.VR
  return MapSeatType.OTHER
}

function parseRectShape(value: unknown): RectShape | null {
  const data = asRecord(value)
  if (!data) return null
  if (data.type !== 'rect') return null

  const x = asNumber(data.x)
  const y = asNumber(data.y)
  const w = asNumber(data.w)
  const h = asNumber(data.h)
  const rotation = asNumber(data.rotation)

  if (x == null || y == null || w == null || h == null) return null
  return {
    type: 'rect',
    x,
    y,
    w,
    h,
    rotation: rotation ?? 0,
  }
}

function parsePolylineShape(value: unknown): PolylineShape | null {
  const data = asRecord(value)
  if (!data) return null
  if (data.type !== 'polyline') return null
  if (!Array.isArray(data.points)) return null

  const points: Array<[number, number]> = []
  for (const point of data.points) {
    if (!Array.isArray(point) || point.length !== 2) return null
    const x = asNumber(point[0])
    const y = asNumber(point[1])
    if (x == null || y == null) return null
    points.push([x, y])
  }

  if (points.length < 2) return null
  const thickness = asNumber(data.thickness)
  return {
    type: 'polyline',
    points,
    thickness: thickness ?? undefined,
  }
}

function rectWithinBounds(shape: RectShape, width: number, height: number) {
  if (shape.x < 0 || shape.y < 0) return false
  if (shape.w <= 0 || shape.h <= 0) return false
  if (shape.x + shape.w > width) return false
  if (shape.y + shape.h > height) return false
  return true
}

function parseFloorBackground(value: unknown) {
  if (value == null) return undefined
  const data = asRecord(value)
  if (!data) return null
  if (data.type !== 'image') return null

  const url = asString(data.url)
  const width = asNumber(data.width)
  const height = asNumber(data.height)
  const opacity = asNumber(data.opacity)

  if (!url || width == null || height == null) return null
  return {
    type: 'image' as const,
    url,
    width,
    height,
    opacity: opacity ?? 1,
  }
}

function serializeGeometry(shape: RectShape) {
  return JSON.stringify({
    type: shape.type,
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    rotation: shape.rotation ?? 0,
  })
}

export function createDefaultSeatMapDraft(mapId: string): SeatMapDocument {
  return {
    schemaVersion: CURRENT_SEAT_MAP_SCHEMA_VERSION,
    mapId,
    version: 0,
    floors: [
      {
        floorId: 'floor-1',
        name: 'Floor 1',
        plane: { width: 2000, height: 1200 },
        rooms: [],
        elements: [],
      },
    ],
  }
}

export function parseSeatMapJson(value: string): SeatMapDocument | null {
  try {
    const parsed = JSON.parse(value) as unknown
    const validation = validateSeatMapDocument(parsed, 'draft')
    if (!validation.document) return null
    return validation.document
  } catch {
    return null
  }
}

export function validateSeatMapDocument(
  input: unknown,
  mode: ValidationMode,
): SeatMapValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const rawRoot = asRecord(input)
  if (!rawRoot) {
    return { errors: ['Map payload must be an object.'], warnings, document: null, seatIndexInputs: [] }
  }

  const root = migrateLegacyMapDocument(rawRoot, warnings)
  const schemaVersion = parseSchemaVersion(root.schemaVersion)
  if (schemaVersion == null) {
    errors.push('schemaVersion must be a positive integer.')
  }

  const mapId = asString(root.mapId)
  const version = asNumber(root.version)
  if (!mapId) errors.push('mapId is required.')
  if (version == null || version < 0) errors.push('version must be a non-negative number.')

  if (!Array.isArray(root.floors)) {
    errors.push('floors must be an array.')
    return { errors, warnings, document: null, seatIndexInputs: [] }
  }

  const floors: SeatMapFloor[] = []
  const floorIds = new Set<string>()
  const seatIds = new Set<string>()
  const seatLabelsNormalized = new Set<string>()
  const seatIndexInputs: SeatIndexInput[] = []

  for (let floorIndex = 0; floorIndex < root.floors.length; floorIndex += 1) {
    const floorData = asRecord(root.floors[floorIndex])
    if (!floorData) {
      errors.push(`floors[${floorIndex}] must be an object.`)
      continue
    }

    const floorId = asString(floorData.floorId)
    const floorName = asString(floorData.name)
    const plane = asRecord(floorData.plane)
    const planeWidth = plane ? asNumber(plane.width) : null
    const planeHeight = plane ? asNumber(plane.height) : null

    if (!floorId) errors.push(`floors[${floorIndex}].floorId is required.`)
    if (!floorName) errors.push(`floors[${floorIndex}].name is required.`)
    if (planeWidth == null || planeWidth <= 0) {
      errors.push(`floors[${floorIndex}].plane.width must be > 0.`)
    }
    if (planeHeight == null || planeHeight <= 0) {
      errors.push(`floors[${floorIndex}].plane.height must be > 0.`)
    }
    if (floorId && floorIds.has(floorId)) {
      errors.push(`Duplicate floorId "${floorId}".`)
    }
    if (floorId) floorIds.add(floorId)

    const background = parseFloorBackground(floorData.background)
    if (floorData.background != null && !background) {
      errors.push(`floors[${floorIndex}].background is invalid.`)
    }

    const roomsInput = Array.isArray(floorData.rooms) ? floorData.rooms : []
    if (!Array.isArray(floorData.rooms)) {
      errors.push(`floors[${floorIndex}].rooms must be an array.`)
    }

    const rooms: SeatMapRoom[] = []
    const roomIds = new Set<string>()
    for (let roomIndex = 0; roomIndex < roomsInput.length; roomIndex += 1) {
      const roomData = asRecord(roomsInput[roomIndex])
      if (!roomData) {
        errors.push(`floors[${floorIndex}].rooms[${roomIndex}] must be an object.`)
        continue
      }

      const roomId = asString(roomData.roomId)
      const roomName = asString(roomData.name)
      const roomType = asString(roomData.roomType) ?? undefined
      const shape = parseRectShape(roomData.shape)

      if (!roomId) errors.push(`floors[${floorIndex}].rooms[${roomIndex}].roomId is required.`)
      if (!roomName) errors.push(`floors[${floorIndex}].rooms[${roomIndex}].name is required.`)
      if (!shape) errors.push(`floors[${floorIndex}].rooms[${roomIndex}].shape must be rect.`)

      if (roomId && roomIds.has(roomId)) {
        errors.push(`Duplicate roomId "${roomId}" on floor "${floorId ?? floorIndex}".`)
      }
      if (roomId) roomIds.add(roomId)

      if (shape && planeWidth != null && planeHeight != null && !rectWithinBounds(shape, planeWidth, planeHeight)) {
        warnings.push(`Room "${roomName ?? roomId ?? roomIndex}" exceeds floor bounds.`)
      }

      if (roomId && roomName && shape) {
        rooms.push({
          roomId,
          name: roomName,
          roomType,
          shape,
        })
      }
    }

    const elementsInput = Array.isArray(floorData.elements) ? floorData.elements : []
    if (!Array.isArray(floorData.elements)) {
      errors.push(`floors[${floorIndex}].elements must be an array.`)
    }

    const elements: SeatMapElement[] = []
    const elementIds = new Set<string>()
    for (let elementIndex = 0; elementIndex < elementsInput.length; elementIndex += 1) {
      const elementData = asRecord(elementsInput[elementIndex])
      if (!elementData) {
        errors.push(`floors[${floorIndex}].elements[${elementIndex}] must be an object.`)
        continue
      }

      const elementId = asString(elementData.id)
      const elementType = asString(elementData.type)
      if (!elementId) {
        errors.push(`floors[${floorIndex}].elements[${elementIndex}].id is required.`)
        continue
      }
      if (elementIds.has(elementId)) {
        errors.push(`Duplicate element id "${elementId}" on floor "${floorId ?? floorIndex}".`)
      }
      elementIds.add(elementId)

      if (elementType === 'seat') {
        const seatId = asString(elementData.seatId)
        const label = asString(elementData.label)
        const roomId = asString(elementData.roomId) ?? undefined
        const segmentId = asString(elementData.segmentId) ?? undefined
        const seatTypeRaw = asString(elementData.seatType) ?? undefined
        const isDisabled = asBoolean(elementData.isDisabled)
        const disableReason = asString(elementData.disableReason)
        const shape = parseRectShape(elementData.shape)

        if (!seatId) errors.push(`Seat element "${elementId}" is missing seatId.`)
        if (!label) errors.push(`Seat element "${elementId}" is missing label.`)
        if (mode === 'publish' && !segmentId) {
          errors.push(`Seat "${label ?? elementId}" is missing segmentId.`)
        }
        if (elementData.isDisabled !== undefined && isDisabled == null) {
          errors.push(`Seat "${label ?? elementId}" has invalid isDisabled value.`)
        }
        if (isDisabled === true && !disableReason) {
          warnings.push(`Seat "${label ?? elementId}" is disabled without reason.`)
        }
        if (!shape) {
          errors.push(`Seat element "${elementId}" must have rect shape.`)
        } else if (planeWidth != null && planeHeight != null && !rectWithinBounds(shape, planeWidth, planeHeight)) {
          errors.push(`Seat "${label ?? elementId}" exceeds floor bounds.`)
        }

        if (seatId && seatIds.has(seatId)) errors.push(`Duplicate seatId "${seatId}".`)
        const normalizedLabel = label?.toLowerCase() ?? null
        if (normalizedLabel && seatLabelsNormalized.has(normalizedLabel)) {
          errors.push(`Duplicate seat label "${label}" (case-insensitive).`)
        }
        if (seatId) seatIds.add(seatId)
        if (normalizedLabel) seatLabelsNormalized.add(normalizedLabel)

        if (roomId && !roomIds.has(roomId)) {
          errors.push(`Seat "${label ?? elementId}" references unknown roomId "${roomId}".`)
        }
        if (!roomId) {
          warnings.push(`Seat "${label ?? elementId}" is not assigned to a room.`)
        }

        if (seatId && label && shape) {
          const seatType = parseMapSeatType(seatTypeRaw)
          elements.push({
            id: elementId,
            type: 'seat',
            seatId,
            label,
            segmentId,
            roomId,
            seatType: seatTypeRaw,
            isDisabled: isDisabled ?? false,
            disableReason: disableReason ?? undefined,
            shape,
          })

          seatIndexInputs.push({
            seatId,
            floorId: floorId ?? `floor-${floorIndex + 1}`,
            roomId: roomId ?? null,
            segmentId: segmentId ?? '',
            label,
            seatType,
            geometry: shape,
            isDisabled: isDisabled ?? false,
            disabledReason: disableReason ?? null,
          })
        }
      } else if (elementType === 'wall') {
        const shape = parsePolylineShape(elementData.shape)
        if (!shape) {
          errors.push(`Wall element "${elementId}" must have a polyline shape with >= 2 points.`)
          continue
        }
        elements.push({
          id: elementId,
          type: 'wall',
          shape,
        })
      } else {
        errors.push(`Element "${elementId}" has unsupported type "${elementType ?? 'unknown'}".`)
      }
    }

    if (floorId && floorName && planeWidth != null && planeHeight != null) {
      floors.push({
        floorId,
        name: floorName,
        plane: { width: planeWidth, height: planeHeight },
        background: background ?? undefined,
        rooms,
        elements,
      })
    }
  }

  if (mode === 'publish' && seatIndexInputs.length === 0) {
    errors.push('At least one seat is required to publish the map.')
  }

  if (mode === 'publish') {
    const activeSeatCount = seatIndexInputs.filter((seat) => !seat.isDisabled).length
    if (activeSeatCount < 1) {
      errors.push('At least one non-disabled seat is required to publish the map.')
    }
    for (const seat of seatIndexInputs) {
      if (!seat.segmentId) {
        errors.push(`Seat "${seat.label}" is missing segmentId.`)
      }
    }
  }

  if (errors.length > 0 || !mapId || version == null || version < 0) {
    return {
      errors,
      warnings,
      document: null,
      seatIndexInputs: [],
    }
  }

  return {
    errors,
    warnings,
    document: {
      schemaVersion: schemaVersion ?? CURRENT_SEAT_MAP_SCHEMA_VERSION,
      mapId,
      version,
      floors,
    },
    seatIndexInputs,
  }
}

export function serializeSeatGeometry(shape: RectShape) {
  return serializeGeometry(shape)
}

export type SeatDiffSummary = {
  added: number
  removed: number
  updated: number
  disabledChanged: number
}

type SeatDiffComparable = {
  seatId: string
  label: string
  segmentId: string
  roomId: string | null
  seatType: MapSeatType
  geometryJson: string
  isDisabled: boolean
  disabledReason: string | null
}

function asComparableMap(items: SeatDiffComparable[]) {
  const map = new Map<string, SeatDiffComparable>()
  for (const item of items) map.set(item.seatId, item)
  return map
}

export function summarizeSeatDiff(
  previousItems: SeatDiffComparable[],
  nextItems: SeatDiffComparable[],
): SeatDiffSummary {
  const previousBySeatId = asComparableMap(previousItems)
  const nextBySeatId = asComparableMap(nextItems)

  let added = 0
  let removed = 0
  let updated = 0
  let disabledChanged = 0

  for (const [seatId, nextItem] of nextBySeatId.entries()) {
    const previousItem = previousBySeatId.get(seatId)
    if (!previousItem) {
      added += 1
      continue
    }
    if (
      previousItem.label !== nextItem.label ||
      previousItem.segmentId !== nextItem.segmentId ||
      previousItem.roomId !== nextItem.roomId ||
      previousItem.seatType !== nextItem.seatType ||
      previousItem.geometryJson !== nextItem.geometryJson ||
      previousItem.isDisabled !== nextItem.isDisabled ||
      previousItem.disabledReason !== nextItem.disabledReason
    ) {
      updated += 1
    }
    if (previousItem.isDisabled !== nextItem.isDisabled) {
      disabledChanged += 1
    }
  }

  for (const seatId of previousBySeatId.keys()) {
    if (!nextBySeatId.has(seatId)) removed += 1
  }

  return { added, removed, updated, disabledChanged }
}

export function collectSeatIdsFromInputs(inputs: SeatIndexInput[]) {
  return inputs.map((item) => item.seatId)
}

export function collectUniqueSegmentIdsFromInputs(inputs: SeatIndexInput[]) {
  return Array.from(new Set(inputs.map((item) => item.segmentId).filter(Boolean)))
}

export function normalizeSeatLabels(labels: string[]) {
  return asStringArray(labels).map((label) => label.trim())
}
