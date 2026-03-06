'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SeatMapDocument, SeatMapFloor, SeatMapRoom, SeatMapSeatElement } from '@/src/lib/seatMapSchema'
import { validateSeatMapDocument } from '@/src/lib/seatMapSchema'

type SegmentOption = {
  id: string
  name: string
  isActive: boolean
}

type Tool = 'select' | 'room' | 'seat' | 'grid' | 'segment-paint' | 'delete'

type SelectionState = {
  seatIds: string[]
  roomId: string | null
}

type GridToolState = {
  rows: number
  cols: number
  seatWidth: number
  seatHeight: number
  gapX: number
  gapY: number
}

type AutoNumberState = {
  rowPrefixMode: 'alpha' | 'numeric'
  rowStart: string
  rowNumberStart: number
  seatStartNumber: number
  rowIncrement: number
  direction: 'ltr' | 'rtl'
  pad: number
}

type LayerToggles = {
  rooms: boolean
  seats: boolean
  labels: boolean
  background: boolean
  grid: boolean
}

type ValidationIssue = {
  id: string
  level: 'error' | 'warning'
  message: string
  seatIds?: string[]
  roomIds?: string[]
}

type Point = {
  x: number
  y: number
}

type MarqueeState = {
  start: Point
  current: Point
  additive: boolean
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

type RectLikeShape = {
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

type DragSession =
  | {
      kind: 'seats'
      start: Point
      current: Point
      seatIds: string[]
    }
  | {
      kind: 'room'
      start: Point
      current: Point
      roomId: string
    }
  | {
      kind: 'resize-seat'
      start: Point
      current: Point
      seatId: string
      handle: ResizeHandle
      originShape: RectLikeShape
    }
  | {
      kind: 'resize-room'
      start: Point
      current: Point
      roomId: string
      handle: ResizeHandle
      originShape: RectLikeShape
    }

type Props = {
  draftText: string
  onDraftTextChange: (next: string) => void
  segments: SegmentOption[]
  disabled?: boolean
}

const HISTORY_LIMIT = 50
const DEFAULT_GRID: GridToolState = {
  rows: 4,
  cols: 5,
  seatWidth: 42,
  seatHeight: 32,
  gapX: 16,
  gapY: 16,
}
const DEFAULT_AUTONUM: AutoNumberState = {
  rowPrefixMode: 'alpha',
  rowStart: 'A',
  rowNumberStart: 1,
  seatStartNumber: 1,
  rowIncrement: 1,
  direction: 'ltr',
  pad: 2,
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function serializeDoc(document: SeatMapDocument) {
  return JSON.stringify(document, null, 2)
}

function safeParseDraft(text: string): { document: SeatMapDocument | null; syntaxError: string | null } {
  if (!text.trim()) return { document: null, syntaxError: null }
  try {
    const raw = JSON.parse(text) as unknown
    const validation = validateSeatMapDocument(raw, 'draft')
    return { document: validation.document, syntaxError: null }
  } catch (error) {
    return {
      document: null,
      syntaxError: error instanceof Error ? error.message : 'Invalid JSON syntax.',
    }
  }
}

function nextId(prefix: string) {
  const random =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis && typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function snap(value: number, enabled: boolean, step: number) {
  if (!enabled || step <= 1) return value
  return Math.round(value / step) * step
}

function rectContainsPoint(
  rect: { x: number; y: number; w: number; h: number },
  point: { x: number; y: number },
) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

function normalizeRect(a: Point, b: Point) {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x)
  const h = Math.abs(a.y - b.y)
  return { x, y, w, h }
}

function resizeRectWithinBounds<T extends RectLikeShape>(
  shape: T,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  bounds: { width: number; height: number },
  minSize: { w: number; h: number },
): T {
  let left = shape.x
  let top = shape.y
  let right = shape.x + shape.w
  let bottom = shape.y + shape.h

  const west = handle === 'nw' || handle === 'sw'
  const east = handle === 'ne' || handle === 'se'
  const north = handle === 'nw' || handle === 'ne'
  const south = handle === 'sw' || handle === 'se'

  if (west) left += dx
  if (east) right += dx
  if (north) top += dy
  if (south) bottom += dy

  left = clamp(left, 0, bounds.width)
  right = clamp(right, 0, bounds.width)
  top = clamp(top, 0, bounds.height)
  bottom = clamp(bottom, 0, bounds.height)

  if (right - left < minSize.w) {
    if (west && !east) {
      left = right - minSize.w
    } else {
      right = left + minSize.w
    }
  }

  if (bottom - top < minSize.h) {
    if (north && !south) {
      top = bottom - minSize.h
    } else {
      bottom = top + minSize.h
    }
  }

  left = clamp(left, 0, bounds.width - minSize.w)
  top = clamp(top, 0, bounds.height - minSize.h)
  right = clamp(right, left + minSize.w, bounds.width)
  bottom = clamp(bottom, top + minSize.h, bounds.height)

  return {
    ...shape,
    x: left,
    y: top,
    w: Math.max(minSize.w, right - left),
    h: Math.max(minSize.h, bottom - top),
  } as T
}

function resizeHandlePoints(shape: RectLikeShape): Record<ResizeHandle, Point> {
  return {
    nw: { x: shape.x, y: shape.y },
    ne: { x: shape.x + shape.w, y: shape.y },
    sw: { x: shape.x, y: shape.y + shape.h },
    se: { x: shape.x + shape.w, y: shape.y + shape.h },
  }
}

function seatCenter(seat: SeatMapSeatElement) {
  return {
    x: seat.shape.x + seat.shape.w / 2,
    y: seat.shape.y + seat.shape.h / 2,
  }
}

function findContainingRoomId(floor: SeatMapFloor, point: { x: number; y: number }) {
  for (const room of floor.rooms) {
    if (rectContainsPoint(room.shape, point)) return room.roomId
  }
  return undefined
}

function floorSeats(floor: SeatMapFloor) {
  return floor.elements.filter((element): element is SeatMapSeatElement => element.type === 'seat')
}

function activeSegmentsFirst(segments: SegmentOption[]) {
  return [...segments].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
}

function segmentColor(segmentId: string | undefined) {
  if (!segmentId) return 'rgba(148,163,184,0.75)'
  let hash = 0
  for (let i = 0; i < segmentId.length; i += 1) hash = (hash * 31 + segmentId.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 55%)`
}

function incrementAlpha(value: string, delta: number) {
  const base = value.trim().toUpperCase() || 'A'
  const first = base.charCodeAt(0)
  const next = clamp(first + delta, 65, 90)
  return String.fromCharCode(next)
}

function buildAutoNumberPreview(selectedSeats: SeatMapSeatElement[], config: AutoNumberState) {
  if (selectedSeats.length === 0) return [] as Array<{ seatId: string; from: string; to: string }>

  const ordered = [...selectedSeats].sort((a, b) => {
    const dy = a.shape.y - b.shape.y
    if (Math.abs(dy) > 12) return dy
    return a.shape.x - b.shape.x
  })

  const rows: SeatMapSeatElement[][] = []
  for (const seat of ordered) {
    const lastRow = rows[rows.length - 1]
    if (!lastRow) {
      rows.push([seat])
      continue
    }
    const rowY = lastRow.reduce((sum, item) => sum + item.shape.y, 0) / lastRow.length
    if (Math.abs(seat.shape.y - rowY) <= 20) {
      lastRow.push(seat)
    } else {
      rows.push([seat])
    }
  }

  const preview: Array<{ seatId: string; from: string; to: string }> = []
  rows.forEach((row, rowIndex) => {
    const rowSeats = [...row].sort((a, b) => a.shape.x - b.shape.x)
    if (config.direction === 'rtl') rowSeats.reverse()

    const rowTag =
      config.rowPrefixMode === 'alpha'
        ? incrementAlpha(config.rowStart, rowIndex * config.rowIncrement)
        : String(config.rowNumberStart + rowIndex * config.rowIncrement)

    rowSeats.forEach((seat, seatIndex) => {
      const n = String(config.seatStartNumber + seatIndex).padStart(config.pad, '0')
      preview.push({ seatId: seat.seatId, from: seat.label, to: `${rowTag}-${n}` })
    })
  })

  return preview
}

function parseLineIssueSeatLabels(message: string, floor: SeatMapFloor) {
  const match = message.match(/Duplicate seat label "([^"]+)"/i)
  if (!match) return undefined
  const dup = match[1].toLowerCase()
  return floorSeats(floor)
    .filter((seat) => seat.label.toLowerCase() === dup)
    .map((seat) => seat.seatId)
}

function parseLineIssueSeatId(message: string) {
  const match = message.match(/Seat "([^"]+)"/)
  if (!match) return undefined
  return match[1]
}

export default function SimpleSeatMapEditor({
  draftText,
  onDraftTextChange,
  segments,
  disabled = false,
}: Props) {
  const [editorText, setEditorText] = useState(draftText)
  const [history, setHistory] = useState<string[]>(draftText ? [draftText] : [''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [tool, setTool] = useState<Tool>('select')
  const [activeFloorId, setActiveFloorId] = useState('')
  const [selection, setSelection] = useState<SelectionState>({ seatIds: [], roomId: null })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [allowJsonEdit, setAllowJsonEdit] = useState(false)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [gridStep, setGridStep] = useState(20)
  const [zoom, setZoom] = useState(0.6)
  const [gridTool, setGridTool] = useState<GridToolState>(DEFAULT_GRID)
  const [autoNumber, setAutoNumber] = useState<AutoNumberState>(DEFAULT_AUTONUM)
  const [segmentPaintId, setSegmentPaintId] = useState('')
  const [layers, setLayers] = useState<LayerToggles>({
    rooms: true,
    seats: true,
    labels: true,
    background: true,
    grid: true,
  })
  const [clipboard, setClipboard] = useState<{ rooms: SeatMapRoom[]; seats: SeatMapSeatElement[] } | null>(null)
  const [validationFocusToken, setValidationFocusToken] = useState<string | null>(null)
  const [dragSession, setDragSession] = useState<DragSession | null>(null)
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const outerRef = useRef<HTMLDivElement | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (draftText !== editorText) {
      setEditorText(draftText)
      setHistory(draftText ? [draftText] : [''])
      setHistoryIndex(0)
      setSelection({ seatIds: [], roomId: null })
    }
  }, [draftText])

  const parsed = useMemo(() => safeParseDraft(editorText), [editorText])

  const validationDraft = useMemo(() => {
    if (!parsed.document) return null
    return validateSeatMapDocument(parsed.document, 'draft')
  }, [parsed.document])

  const validationPublish = useMemo(() => {
    if (!parsed.document) return null
    return validateSeatMapDocument(parsed.document, 'publish')
  }, [parsed.document])

  const floors = parsed.document?.floors ?? []
  const activeFloor = useMemo(() => {
    if (!parsed.document) return null
    if (floors.length === 0) return null
    return floors.find((floor) => floor.floorId === activeFloorId) ?? floors[0]
  }, [parsed.document, floors, activeFloorId])

  useEffect(() => {
    if (!activeFloor) {
      if (activeFloorId) setActiveFloorId('')
      return
    }
    if (activeFloor.floorId !== activeFloorId) setActiveFloorId(activeFloor.floorId)
  }, [activeFloor, activeFloorId])

  const selectedSeats = useMemo(() => {
    if (!activeFloor) return []
    const selected = new Set(selection.seatIds)
    return floorSeats(activeFloor).filter((seat) => selected.has(seat.seatId))
  }, [activeFloor, selection.seatIds])

  const selectedRoom = useMemo(() => {
    if (!activeFloor || !selection.roomId) return null
    return activeFloor.rooms.find((room) => room.roomId === selection.roomId) ?? null
  }, [activeFloor, selection.roomId])

  const segmentOptions = useMemo(() => activeSegmentsFirst(segments), [segments])
  const defaultSegmentId = segmentOptions.find((segment) => segment.isActive)?.id ?? segmentOptions[0]?.id ?? ''

  useEffect(() => {
    if (!segmentPaintId && defaultSegmentId) setSegmentPaintId(defaultSegmentId)
  }, [defaultSegmentId, segmentPaintId])

  const seatCountBySegment = useMemo(() => {
    if (!activeFloor) return [] as Array<{ segmentId: string; count: number }>
    const counts = new Map<string, number>()
    for (const seat of floorSeats(activeFloor)) {
      const key = seat.segmentId || '__missing__'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].map(([segmentId, count]) => ({ segmentId, count }))
  }, [activeFloor])

  const validationIssues = useMemo(() => {
    const issues: ValidationIssue[] = []
    if (!activeFloor) return issues
    if (validationPublish) {
      validationPublish.errors.forEach((message, index) => {
        const duplicateSeatIds = parseLineIssueSeatLabels(message, activeFloor)
        issues.push({
          id: `publish-error-${index}`,
          level: 'error',
          message,
          seatIds: duplicateSeatIds,
        })
      })
      validationPublish.warnings.forEach((message, index) => {
        const parsedSeatLabel = parseLineIssueSeatId(message)
        const seatIds = parsedSeatLabel
          ? floorSeats(activeFloor)
              .filter((seat) => seat.label === parsedSeatLabel)
              .map((seat) => seat.seatId)
          : undefined
        issues.push({ id: `publish-warning-${index}`, level: 'warning', message, seatIds })
      })
    }

    const seats = floorSeats(activeFloor)
    const seatsMissingSegment = seats.filter((seat) => !seat.segmentId)
    if (seatsMissingSegment.length > 0) {
      issues.unshift({
        id: 'custom-missing-segment',
        level: 'warning',
        message: `${seatsMissingSegment.length} seat(s) missing segment assignment.`,
        seatIds: seatsMissingSegment.map((seat) => seat.seatId),
      })
    }

    if (activeFloor.rooms.length > 0) {
      const outside = seats.filter((seat) => {
        const center = seatCenter(seat)
        return !activeFloor.rooms.some((room) => rectContainsPoint(room.shape, center))
      })
      if (outside.length > 0) {
        issues.push({
          id: 'custom-outside-room',
          level: 'warning',
          message: `${outside.length} seat(s) outside any room boundary.`,
          seatIds: outside.map((seat) => seat.seatId),
        })
      }
    }

    return issues
  }, [activeFloor, validationPublish])

  const autoNumberPreview = useMemo(
    () => buildAutoNumberPreview(selectedSeats, autoNumber).slice(0, 12),
    [selectedSeats, autoNumber],
  )

  const dragDelta = useMemo(() => {
    if (!dragSession) return null
    const rawDx = dragSession.current.x - dragSession.start.x
    const rawDy = dragSession.current.y - dragSession.start.y
    return {
      dx: snap(rawDx, snapToGrid, gridStep),
      dy: snap(rawDy, snapToGrid, gridStep),
      rawDx,
      rawDy,
    }
  }, [dragSession, snapToGrid, gridStep])

  const marqueeRect = useMemo(
    () => (marquee ? normalizeRect(marquee.start, marquee.current) : null),
    [marquee],
  )

  function pushHistory(nextText: string) {
    setHistory((current) => {
      const base = current.slice(0, historyIndex + 1)
      if (base[base.length - 1] === nextText) return base
      const next = [...base, nextText]
      if (next.length <= HISTORY_LIMIT) return next
      return next.slice(next.length - HISTORY_LIMIT)
    })
    setHistoryIndex((current) => {
      const next = current + 1
      return next >= HISTORY_LIMIT ? HISTORY_LIMIT - 1 : next
    })
  }

  function commitText(nextText: string, options?: { pushHistory?: boolean }) {
    const normalized = nextText
    setEditorText(normalized)
    onDraftTextChange(normalized)
    if (options?.pushHistory !== false) pushHistory(normalized)
  }

  function mutateDocument(mutator: (draft: SeatMapDocument) => void) {
    if (!parsed.document) return
    const nextDoc = deepClone(parsed.document)
    mutator(nextDoc)
    commitText(serializeDoc(nextDoc))
  }

  function mutateActiveFloor(mutator: (floor: SeatMapFloor, root: SeatMapDocument) => void) {
    if (!parsed.document || !activeFloor) return
    mutateDocument((root) => {
      const floor = root.floors.find((item) => item.floorId === activeFloor.floorId)
      if (!floor) return
      mutator(floor, root)
    })
  }

  function clearSelection() {
    setSelection({ seatIds: [], roomId: null })
  }

  function selectIssue(issue: ValidationIssue) {
    setValidationFocusToken(issue.id)
    setSelection({
      seatIds: issue.seatIds ?? [],
      roomId: issue.roomIds?.[0] ?? null,
    })
    if (issue.seatIds && issue.seatIds.length > 0 && activeFloor && outerRef.current) {
      const firstSeat = floorSeats(activeFloor).find((seat) => seat.seatId === issue.seatIds?.[0])
      if (firstSeat) {
        const cx = (firstSeat.shape.x + firstSeat.shape.w / 2) * zoom
        const cy = (firstSeat.shape.y + firstSeat.shape.h / 2) * zoom
        outerRef.current.scrollTo({
          left: Math.max(0, cx - outerRef.current.clientWidth / 2),
          top: Math.max(0, cy - outerRef.current.clientHeight / 2),
          behavior: 'smooth',
        })
      }
    }
  }

  function getPointerPointFromClient(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (!rect.width || !rect.height || !activeFloor) return null
    const scaleX = activeFloor.plane.width / rect.width
    const scaleY = activeFloor.plane.height / rect.height
    const x = (clientX - rect.left) * scaleX
    const y = (clientY - rect.top) * scaleY
    return { x, y }
  }

  function getPointerPoint(event: React.MouseEvent<SVGSVGElement>) {
    return getPointerPointFromClient(event.clientX, event.clientY)
  }

  function addRoomAt(point: { x: number; y: number }) {
    mutateActiveFloor((floor) => {
      const w = 420
      const h = 260
      const x = clamp(snap(point.x - w / 2, snapToGrid, gridStep), 0, Math.max(0, floor.plane.width - w))
      const y = clamp(snap(point.y - h / 2, snapToGrid, gridStep), 0, Math.max(0, floor.plane.height - h))
      floor.rooms.push({
        roomId: nextId('room'),
        name: `Room ${floor.rooms.length + 1}`,
        shape: { type: 'rect', x, y, w, h, rotation: 0 },
      })
    })
  }

  function addSeatAt(point: { x: number; y: number }) {
    mutateActiveFloor((floor) => {
      const w = 42
      const h = 32
      const x = clamp(snap(point.x - w / 2, snapToGrid, gridStep), 0, Math.max(0, floor.plane.width - w))
      const y = clamp(snap(point.y - h / 2, snapToGrid, gridStep), 0, Math.max(0, floor.plane.height - h))
      const seatId = nextId('seat')
      const elementId = nextId('el-seat')
      const candidateLabel = `S-${String(floorSeats(floor).length + 1).padStart(2, '0')}`
      const roomId = findContainingRoomId(floor, { x: x + w / 2, y: y + h / 2 })
      floor.elements.push({
        id: elementId,
        type: 'seat',
        seatId,
        label: candidateLabel,
        segmentId: defaultSegmentId || undefined,
        roomId,
        seatType: 'PC',
        isDisabled: false,
        shape: { type: 'rect', x, y, w, h, rotation: 0 },
      })
      setSelection({ seatIds: [seatId], roomId: null })
    })
  }

  function addSeatGridAt(point: { x: number; y: number }) {
    mutateActiveFloor((floor) => {
      const seatsExisting = floorSeats(floor).length
      const createdSeatIds: string[] = []
      const baseX = snap(point.x, snapToGrid, gridStep)
      const baseY = snap(point.y, snapToGrid, gridStep)

      for (let r = 0; r < gridTool.rows; r += 1) {
        for (let c = 0; c < gridTool.cols; c += 1) {
          const x = clamp(
            baseX + c * (gridTool.seatWidth + gridTool.gapX),
            0,
            Math.max(0, floor.plane.width - gridTool.seatWidth),
          )
          const y = clamp(
            baseY + r * (gridTool.seatHeight + gridTool.gapY),
            0,
            Math.max(0, floor.plane.height - gridTool.seatHeight),
          )
          const seatId = nextId('seat')
          createdSeatIds.push(seatId)
          const label = `S-${String(seatsExisting + createdSeatIds.length).padStart(2, '0')}`
          const roomId = findContainingRoomId(floor, {
            x: x + gridTool.seatWidth / 2,
            y: y + gridTool.seatHeight / 2,
          })
          floor.elements.push({
            id: nextId('el-seat'),
            type: 'seat',
            seatId,
            label,
            segmentId: defaultSegmentId || undefined,
            roomId,
            seatType: 'PC',
            isDisabled: false,
            shape: {
              type: 'rect',
              x,
              y,
              w: gridTool.seatWidth,
              h: gridTool.seatHeight,
              rotation: 0,
            },
          })
        }
      }
      setSelection({ seatIds: createdSeatIds, roomId: null })
    })
  }

  function deleteSelection() {
    if (!activeFloor) return
    if (selection.seatIds.length === 0 && !selection.roomId) return
    mutateActiveFloor((floor) => {
      if (selection.seatIds.length > 0) {
        const selected = new Set(selection.seatIds)
        floor.elements = floor.elements.filter(
          (element) => element.type !== 'seat' || !selected.has(element.seatId),
        )
      }
      if (selection.roomId) {
        floor.rooms = floor.rooms.filter((room) => room.roomId !== selection.roomId)
        for (const element of floor.elements) {
          if (element.type === 'seat' && element.roomId === selection.roomId) {
            delete element.roomId
          }
        }
      }
      clearSelection()
    })
  }

  function nudgeSelection(dx: number, dy: number) {
    if (!activeFloor) return
    const selectedSeatsSet = new Set(selection.seatIds)
    mutateActiveFloor((floor) => {
      if (selection.roomId) {
        const room = floor.rooms.find((item) => item.roomId === selection.roomId)
        if (room) {
          room.shape.x = clamp(room.shape.x + dx, 0, Math.max(0, floor.plane.width - room.shape.w))
          room.shape.y = clamp(room.shape.y + dy, 0, Math.max(0, floor.plane.height - room.shape.h))
        }
      }
      for (const element of floor.elements) {
        if (element.type !== 'seat') continue
        if (!selectedSeatsSet.has(element.seatId)) continue
        element.shape.x = clamp(element.shape.x + dx, 0, Math.max(0, floor.plane.width - element.shape.w))
        element.shape.y = clamp(element.shape.y + dy, 0, Math.max(0, floor.plane.height - element.shape.h))
        const center = seatCenter(element)
        element.roomId = findContainingRoomId(floor, center)
      }
    })
  }

  function assignSegmentToSelected(segmentId: string) {
    if (!segmentId) return
    if (selection.seatIds.length < 1) return
    const selected = new Set(selection.seatIds)
    mutateActiveFloor((floor) => {
      for (const element of floor.elements) {
        if (element.type === 'seat' && selected.has(element.seatId)) {
          element.segmentId = segmentId
        }
      }
    })
  }

  function autoNumberSelectedSeats() {
    if (selectedSeats.length < 1 || !activeFloor) return
    const preview = buildAutoNumberPreview(selectedSeats, autoNumber)
    const bySeatId = new Map(preview.map((item) => [item.seatId, item.to]))
    mutateActiveFloor((floor) => {
      for (const element of floor.elements) {
        if (element.type !== 'seat') continue
        const nextLabel = bySeatId.get(element.seatId)
        if (nextLabel) element.label = nextLabel
      }
    })
  }

  function commitDrag(session: DragSession) {
    if (!activeFloor) return
    const delta = {
      dx: snap(session.current.x - session.start.x, snapToGrid, gridStep),
      dy: snap(session.current.y - session.start.y, snapToGrid, gridStep),
    }
    if (Math.abs(delta.dx) < 1 && Math.abs(delta.dy) < 1) return

    if (session.kind === 'seats') {
      const selectedSet = new Set(session.seatIds)
      mutateActiveFloor((floor) => {
        for (const element of floor.elements) {
          if (element.type !== 'seat' || !selectedSet.has(element.seatId)) continue
          element.shape.x = clamp(
            element.shape.x + delta.dx,
            0,
            Math.max(0, floor.plane.width - element.shape.w),
          )
          element.shape.y = clamp(
            element.shape.y + delta.dy,
            0,
            Math.max(0, floor.plane.height - element.shape.h),
          )
          element.roomId = findContainingRoomId(floor, seatCenter(element))
        }
      })
      return
    }

    if (session.kind === 'resize-seat') {
      mutateActiveFloor((floor) => {
        const target = floor.elements.find(
          (element): element is SeatMapSeatElement =>
            element.type === 'seat' && element.seatId === session.seatId,
        )
        if (!target) return
        target.shape = resizeRectWithinBounds(
          target.shape,
          session.handle,
          delta.dx,
          delta.dy,
          { width: floor.plane.width, height: floor.plane.height },
          { w: 12, h: 12 },
        )
        target.roomId = findContainingRoomId(floor, seatCenter(target))
      })
      return
    }

    if (session.kind === 'resize-room') {
      mutateActiveFloor((floor) => {
        const target = floor.rooms.find((room) => room.roomId === session.roomId)
        if (!target) return
        target.shape = resizeRectWithinBounds(
          target.shape,
          session.handle,
          delta.dx,
          delta.dy,
          { width: floor.plane.width, height: floor.plane.height },
          { w: 80, h: 60 },
        )
      })
      return
    }

    mutateActiveFloor((floor) => {
      const room = floor.rooms.find((item) => item.roomId === session.roomId)
      if (!room) return
      room.shape.x = clamp(room.shape.x + delta.dx, 0, Math.max(0, floor.plane.width - room.shape.w))
      room.shape.y = clamp(room.shape.y + delta.dy, 0, Math.max(0, floor.plane.height - room.shape.h))
    })
  }

  function finalizeMarqueeSelection(nextMarquee: MarqueeState) {
    if (!activeFloor) return
    const rect = normalizeRect(nextMarquee.start, nextMarquee.current)
    if (rect.w < 4 && rect.h < 4) return
    const hitSeatIds = floorSeats(activeFloor)
      .filter((seat) => rectContainsPoint(rect, seatCenter(seat)))
      .map((seat) => seat.seatId)

    setSelection((current) => {
      if (!nextMarquee.additive) return { seatIds: hitSeatIds, roomId: null }
      const merged = new Set([...current.seatIds, ...hitSeatIds])
      return { roomId: null, seatIds: [...merged] }
    })
    suppressClickRef.current = true
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled || !activeFloor) return
    const point = getPointerPoint(event)
    if (!point) return
    if (tool === 'room') {
      addRoomAt(point)
      return
    }
    if (tool === 'seat') {
      addSeatAt(point)
      return
    }
    if (tool === 'grid') {
      addSeatGridAt(point)
      return
    }
    if (tool === 'select') {
      clearSelection()
    }
  }

  function handleCanvasMouseDown(event: React.MouseEvent<SVGSVGElement>) {
    if (disabled || !activeFloor || tool !== 'select') return
    if (event.button !== 0) return
    const point = getPointerPoint(event)
    if (!point) return
    setMarquee({
      start: point,
      current: point,
      additive: event.shiftKey,
    })
  }

  function handleSeatClick(event: React.MouseEvent, seat: SeatMapSeatElement) {
    event.stopPropagation()
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    if (tool === 'delete') {
      mutateActiveFloor((floor) => {
        floor.elements = floor.elements.filter(
          (element) => element.type !== 'seat' || element.seatId !== seat.seatId,
        )
      })
      setSelection({ seatIds: [], roomId: null })
      return
    }
    if (tool === 'segment-paint') {
      if (segmentPaintId) {
        mutateActiveFloor((floor) => {
          const target = floor.elements.find(
            (element): element is SeatMapSeatElement =>
              element.type === 'seat' && element.seatId === seat.seatId,
          )
          if (target) target.segmentId = segmentPaintId
        })
        setSelection({ seatIds: [seat.seatId], roomId: null })
      }
      return
    }

    if (tool === 'select') {
      setSelection((current) => {
        if (event.shiftKey) {
          const exists = current.seatIds.includes(seat.seatId)
          return {
            roomId: null,
            seatIds: exists
              ? current.seatIds.filter((id) => id !== seat.seatId)
              : [...current.seatIds, seat.seatId],
          }
        }
        return { seatIds: [seat.seatId], roomId: null }
      })
    }
  }

  function handleSeatMouseDown(event: React.MouseEvent, seat: SeatMapSeatElement) {
    event.stopPropagation()
    if (disabled || tool !== 'select' || !activeFloor) return
    if (event.button !== 0) return
    if (event.shiftKey) return
    const point = getPointerPointFromClient(event.clientX, event.clientY)
    if (!point) return

    const selectedIds =
      selection.roomId == null && selection.seatIds.includes(seat.seatId)
        ? [...selection.seatIds]
        : [seat.seatId]

    if (selection.roomId || !selection.seatIds.includes(seat.seatId)) {
      setSelection({ seatIds: [seat.seatId], roomId: null })
    }

    setDragSession({
      kind: 'seats',
      start: point,
      current: point,
      seatIds: selectedIds,
    })
  }

  function handleSeatResizeMouseDown(
    event: React.MouseEvent,
    seat: SeatMapSeatElement,
    handle: ResizeHandle,
  ) {
    event.stopPropagation()
    if (disabled || tool !== 'select') return
    if (event.button !== 0) return
    const point = getPointerPointFromClient(event.clientX, event.clientY)
    if (!point) return
    setSelection({ seatIds: [seat.seatId], roomId: null })
    setDragSession({
      kind: 'resize-seat',
      start: point,
      current: point,
      seatId: seat.seatId,
      handle,
      originShape: { ...seat.shape },
    })
  }

  function handleRoomClick(event: React.MouseEvent, room: SeatMapRoom) {
    event.stopPropagation()
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (disabled) return
    if (tool === 'delete') {
      mutateActiveFloor((floor) => {
        floor.rooms = floor.rooms.filter((item) => item.roomId !== room.roomId)
        for (const element of floor.elements) {
          if (element.type === 'seat' && element.roomId === room.roomId) {
            delete element.roomId
          }
        }
      })
      setSelection({ seatIds: [], roomId: null })
      return
    }
    if (tool === 'select') {
      setSelection({ seatIds: [], roomId: room.roomId })
    }
  }

  function handleRoomMouseDown(event: React.MouseEvent, room: SeatMapRoom) {
    event.stopPropagation()
    if (disabled || tool !== 'select') return
    if (event.button !== 0) return
    const point = getPointerPointFromClient(event.clientX, event.clientY)
    if (!point) return
    if (selection.roomId !== room.roomId || selection.seatIds.length > 0) {
      setSelection({ seatIds: [], roomId: room.roomId })
    }
    setDragSession({
      kind: 'room',
      start: point,
      current: point,
      roomId: room.roomId,
    })
  }

  function handleRoomResizeMouseDown(
    event: React.MouseEvent,
    room: SeatMapRoom,
    handle: ResizeHandle,
  ) {
    event.stopPropagation()
    if (disabled || tool !== 'select') return
    if (event.button !== 0) return
    const point = getPointerPointFromClient(event.clientX, event.clientY)
    if (!point) return
    setSelection({ seatIds: [], roomId: room.roomId })
    setDragSession({
      kind: 'resize-room',
      start: point,
      current: point,
      roomId: room.roomId,
      handle,
      originShape: { ...room.shape },
    })
  }

  function updateSelectedSeat(updater: (seat: SeatMapSeatElement) => void) {
    if (selection.seatIds.length !== 1) return
    const selectedSeatId = selection.seatIds[0]
    mutateActiveFloor((floor) => {
      const seat = floor.elements.find(
        (element): element is SeatMapSeatElement => element.type === 'seat' && element.seatId === selectedSeatId,
      )
      if (!seat) return
      updater(seat)
      seat.roomId = findContainingRoomId(floor, seatCenter(seat))
    })
  }

  function updateSelectedRoom(updater: (room: SeatMapRoom) => void) {
    if (!selection.roomId) return
    mutateActiveFloor((floor) => {
      const room = floor.rooms.find((item) => item.roomId === selection.roomId)
      if (!room) return
      updater(room)
    })
  }

  function copySelection() {
    if (!activeFloor) return
    const selectedSeatSet = new Set(selection.seatIds)
    const rooms = selection.roomId
      ? activeFloor.rooms.filter((room) => room.roomId === selection.roomId).map((room) => deepClone(room))
      : []
    const seats = floorSeats(activeFloor)
      .filter((seat) => selectedSeatSet.has(seat.seatId))
      .map((seat) => deepClone(seat))
    if (rooms.length > 0 || seats.length > 0) {
      setClipboard({ rooms, seats })
    }
  }

  function pasteClipboard() {
    if (!clipboard || !activeFloor) return
    mutateActiveFloor((floor) => {
      const pastedSeatIds: string[] = []
      const roomIdMap = new Map<string, string>()

      for (const room of clipboard.rooms) {
        const nextRoomId = nextId('room')
        roomIdMap.set(room.roomId, nextRoomId)
        floor.rooms.push({
          ...deepClone(room),
          roomId: nextRoomId,
          name: `${room.name} Copy`,
          shape: {
            ...room.shape,
            x: clamp(room.shape.x + 40, 0, Math.max(0, floor.plane.width - room.shape.w)),
            y: clamp(room.shape.y + 40, 0, Math.max(0, floor.plane.height - room.shape.h)),
          },
        })
      }

      for (const seat of clipboard.seats) {
        const nextSeatId = nextId('seat')
        pastedSeatIds.push(nextSeatId)
        floor.elements.push({
          ...deepClone(seat),
          id: nextId('el-seat'),
          seatId: nextSeatId,
          label: `${seat.label}-copy`,
          roomId: seat.roomId ? roomIdMap.get(seat.roomId) ?? seat.roomId : seat.roomId,
          shape: {
            ...seat.shape,
            x: clamp(seat.shape.x + 40, 0, Math.max(0, floor.plane.width - seat.shape.w)),
            y: clamp(seat.shape.y + 40, 0, Math.max(0, floor.plane.height - seat.shape.h)),
          },
        })
      }

      setSelection({ seatIds: pastedSeatIds, roomId: null })
    })
  }

  function formatJson() {
    try {
      const parsedRaw = JSON.parse(editorText) as unknown
      commitText(JSON.stringify(parsedRaw, null, 2))
    } catch {
      // ignore; validation panel already surfaces syntax errors
    }
  }

  function undo() {
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const nextText = history[nextIndex]
    setHistoryIndex(nextIndex)
    setEditorText(nextText)
    onDraftTextChange(nextText)
  }

  function redo() {
    if (historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const nextText = history[nextIndex]
    setHistoryIndex(nextIndex)
    setEditorText(nextText)
    onDraftTextChange(nextText)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toLowerCase()
      const inInput = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable
      const mod = event.metaKey || event.ctrlKey

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (mod && event.key.toLowerCase() === 'c' && !inInput) {
        event.preventDefault()
        copySelection()
        return
      }
      if (mod && event.key.toLowerCase() === 'v' && !inInput) {
        event.preventDefault()
        pasteClipboard()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !inInput) {
        event.preventDefault()
        deleteSelection()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [history, historyIndex, selection, clipboard, activeFloor, parsed.document, editorText])

  useEffect(() => {
    if (!dragSession && !marquee) return

    function onMouseMove(event: MouseEvent) {
      const point = getPointerPointFromClient(event.clientX, event.clientY)
      if (!point) return
      if (dragSession) {
        setDragSession((current) => (current ? { ...current, current: point } : current))
      }
      if (marquee) {
        setMarquee((current) => (current ? { ...current, current: point } : current))
      }
    }

    function onMouseUp(event: MouseEvent) {
      const point = getPointerPointFromClient(event.clientX, event.clientY)

      if (dragSession) {
        const completed = point ? { ...dragSession, current: point } : dragSession
        const movedDistance = Math.hypot(
          completed.current.x - completed.start.x,
          completed.current.y - completed.start.y,
        )
        if (movedDistance >= 4) {
          commitDrag(completed)
          suppressClickRef.current = true
        }
        setDragSession(null)
      }

      if (marquee) {
        const completed = point ? { ...marquee, current: point } : marquee
        finalizeMarqueeSelection(completed)
        setMarquee(null)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragSession, marquee, activeFloor, snapToGrid, gridStep, selection])

  const canPublishBasedOnValidation = (validationPublish?.errors.length ?? 0) === 0

  function previewRoomShape(room: SeatMapRoom) {
    if (!dragSession || !dragDelta) return room.shape
    if (dragSession.kind === 'resize-room' && dragSession.roomId === room.roomId && activeFloor) {
      return resizeRectWithinBounds(
        dragSession.originShape,
        dragSession.handle,
        dragDelta.dx,
        dragDelta.dy,
        { width: activeFloor.plane.width, height: activeFloor.plane.height },
        { w: 80, h: 60 },
      )
    }
    if (dragSession.kind !== 'room' || dragSession.roomId !== room.roomId) return room.shape
    return {
      ...room.shape,
      x: room.shape.x + dragDelta.dx,
      y: room.shape.y + dragDelta.dy,
    }
  }

  function previewSeatShape(seat: SeatMapSeatElement) {
    if (!dragSession || !dragDelta) return seat.shape
    if (dragSession.kind === 'resize-seat' && dragSession.seatId === seat.seatId && activeFloor) {
      return resizeRectWithinBounds(
        dragSession.originShape,
        dragSession.handle,
        dragDelta.dx,
        dragDelta.dy,
        { width: activeFloor.plane.width, height: activeFloor.plane.height },
        { w: 12, h: 12 },
      )
    }
    if (dragSession.kind !== 'seats' || !dragSession.seatIds.includes(seat.seatId)) return seat.shape
    return {
      ...seat.shape,
      x: seat.shape.x + dragDelta.dx,
      y: seat.shape.y + dragDelta.dy,
    }
  }

  return (
    <div className="space-y-4">
      <div className="panel-strong p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span className="chip">Simple Editor (WYSIWYG)</span>
          <span>Undo/Redo: {historyIndex + 1}/{history.length}</span>
          <span>Publish validation: {canPublishBasedOnValidation ? 'passable' : 'blocked'}</span>
          <span>Tool: {tool}</span>
        </div>
      </div>

      {parsed.syntaxError ? (
        <div className="panel-strong border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
          Draft JSON syntax is invalid: {parsed.syntaxError}. Fix it in Advanced mode to continue.
        </div>
      ) : null}

      {!parsed.document ? (
        <details className="panel-strong p-4" open>
          <summary className="cursor-pointer text-sm font-medium">Advanced (JSON)</summary>
          <div className="mt-3 space-y-2">
            <textarea
              className="panel min-h-[320px] w-full rounded-lg px-3 py-2 font-mono text-xs"
              value={editorText}
              onChange={(event) => {
                setEditorText(event.target.value)
                onDraftTextChange(event.target.value)
              }}
              spellCheck={false}
            />
          </div>
        </details>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_340px]">
          <aside className="panel-strong space-y-4 p-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Tools</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {([
                  ['select', 'Select'],
                  ['room', 'Room'],
                  ['seat', 'Seat'],
                  ['grid', 'Seat Block'],
                  ['segment-paint', 'Segment Paint'],
                  ['delete', 'Delete'],
                ] as Array<[Tool, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-lg border px-2 py-2 text-left ${
                      tool === value
                        ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_20%,transparent)]'
                        : 'border-[var(--border)] hover:bg-white/10'
                    }`}
                    onClick={() => setTool(value)}
                    disabled={disabled}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Canvas</p>
              <label className="flex flex-col gap-1 text-xs">
                Floor
                <select
                  className="panel rounded-lg px-2 py-2 text-sm"
                  value={activeFloor?.floorId ?? ''}
                  onChange={(event) => setActiveFloorId(event.target.value)}
                  disabled={disabled}
                >
                  {floors.map((floor) => (
                    <option key={floor.floorId} value={floor.floorId}>
                      {floor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Zoom ({Math.round(zoom * 100)}%)
                <input
                  type="range"
                  min={30}
                  max={150}
                  step={5}
                  value={Math.round(zoom * 100)}
                  onChange={(event) => setZoom(Number(event.target.value) / 100)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={snapToGrid}
                  onChange={(event) => setSnapToGrid(event.target.checked)}
                />
                Snap to grid
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Grid step
                <input
                  className="panel rounded-lg px-2 py-2 text-sm"
                  type="number"
                  min={5}
                  max={200}
                  value={gridStep}
                  onChange={(event) => setGridStep(Math.max(5, Number(event.target.value) || 20))}
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {(
                  [
                    ['rooms', 'Rooms'],
                    ['seats', 'Seats'],
                    ['labels', 'Labels'],
                    ['background', 'Bg'],
                    ['grid', 'Grid'],
                  ] as Array<[keyof LayerToggles, string]>
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={layers[key]}
                      onChange={(event) => setLayers((cur) => ({ ...cur, [key]: event.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {tool === 'grid' ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Seat Block Tool</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex flex-col gap-1">
                    Rows
                    <input className="panel rounded px-2 py-1" type="number" min={1} max={20} value={gridTool.rows} onChange={(e) => setGridTool((g) => ({ ...g, rows: clamp(Number(e.target.value) || 1, 1, 20) }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Cols
                    <input className="panel rounded px-2 py-1" type="number" min={1} max={30} value={gridTool.cols} onChange={(e) => setGridTool((g) => ({ ...g, cols: clamp(Number(e.target.value) || 1, 1, 30) }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Seat W
                    <input className="panel rounded px-2 py-1" type="number" min={20} max={120} value={gridTool.seatWidth} onChange={(e) => setGridTool((g) => ({ ...g, seatWidth: clamp(Number(e.target.value) || 42, 20, 120) }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Seat H
                    <input className="panel rounded px-2 py-1" type="number" min={20} max={120} value={gridTool.seatHeight} onChange={(e) => setGridTool((g) => ({ ...g, seatHeight: clamp(Number(e.target.value) || 32, 20, 120) }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Gap X
                    <input className="panel rounded px-2 py-1" type="number" min={0} max={200} value={gridTool.gapX} onChange={(e) => setGridTool((g) => ({ ...g, gapX: clamp(Number(e.target.value) || 0, 0, 200) }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Gap Y
                    <input className="panel rounded px-2 py-1" type="number" min={0} max={200} value={gridTool.gapY} onChange={(e) => setGridTool((g) => ({ ...g, gapY: clamp(Number(e.target.value) || 0, 0, 200) }))} />
                  </label>
                </div>
                <p className="text-xs text-[var(--muted)]">Click canvas to place the top-left of a grid block.</p>
              </div>
            ) : null}

            {tool === 'segment-paint' ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Segment Paint</p>
                <select
                  className="panel w-full rounded-lg px-2 py-2 text-sm"
                  value={segmentPaintId}
                  onChange={(event) => setSegmentPaintId(event.target.value)}
                >
                  <option value="">Select segment</option>
                  {segmentOptions.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name} {segment.isActive ? '' : '(inactive)'}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[var(--muted)]">Click seats to assign the selected segment.</p>
              </div>
            ) : null}
          </aside>

          <section className="panel-strong space-y-3 p-3">
            {activeFloor ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-medium">Canvas</p>
                    <p className="text-xs text-[var(--muted)]">
                      {activeFloor.name} · {activeFloor.plane.width}×{activeFloor.plane.height} · {floorSeats(activeFloor).length} seats
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={undo} disabled={disabled || historyIndex <= 0}>Undo</button>
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={redo} disabled={disabled || historyIndex >= history.length - 1}>Redo</button>
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={copySelection} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>Copy</button>
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={pasteClipboard} disabled={disabled || !clipboard}>Paste</button>
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={deleteSelection} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>Delete</button>
                  </div>
                </div>

                <div ref={outerRef} className="overflow-auto rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--panel)_85%,black)] p-2">
                  <div style={{ width: activeFloor.plane.width * zoom, height: activeFloor.plane.height * zoom }}>
                    <svg
                      ref={svgRef}
                      role="img"
                      aria-label="Seat map editor canvas"
                      width={activeFloor.plane.width * zoom}
                      height={activeFloor.plane.height * zoom}
                      viewBox={`0 0 ${activeFloor.plane.width} ${activeFloor.plane.height}`}
                      className="block cursor-crosshair"
                      onMouseDown={handleCanvasMouseDown}
                      onClick={handleCanvasClick}
                    >
                      {layers.background && activeFloor.background?.type === 'image' ? (
                        <image
                          href={activeFloor.background.url}
                          x={0}
                          y={0}
                          width={activeFloor.background.width}
                          height={activeFloor.background.height}
                          opacity={activeFloor.background.opacity ?? 0.35}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      ) : null}

                      <rect x={0} y={0} width={activeFloor.plane.width} height={activeFloor.plane.height} fill="rgba(2,6,23,0.4)" />
                      {layers.grid ? (
                        <g opacity={0.45}>
                          {Array.from({ length: Math.ceil(activeFloor.plane.width / gridStep) + 1 }, (_, i) => (
                            <line key={`vx-${i}`} x1={i * gridStep} y1={0} x2={i * gridStep} y2={activeFloor.plane.height} stroke="rgba(148,163,184,0.18)" strokeWidth={1} />
                          ))}
                          {Array.from({ length: Math.ceil(activeFloor.plane.height / gridStep) + 1 }, (_, i) => (
                            <line key={`hz-${i}`} x1={0} y1={i * gridStep} x2={activeFloor.plane.width} y2={i * gridStep} stroke="rgba(148,163,184,0.18)" strokeWidth={1} />
                          ))}
                        </g>
                      ) : null}

                      {layers.rooms
                        ? activeFloor.rooms.map((room) => {
                            const roomShape = previewRoomShape(room)
                            const isSelected = selection.roomId === room.roomId
                            const roomHandles = isSelected && tool === 'select' ? resizeHandlePoints(roomShape) : null
                            return (
                              <g
                                key={room.roomId}
                                onMouseDown={(event) => handleRoomMouseDown(event, room)}
                                onClick={(event) => handleRoomClick(event, room)}
                              >
                                <rect
                                  x={roomShape.x}
                                  y={roomShape.y}
                                  width={roomShape.w}
                                  height={roomShape.h}
                                  rx={8}
                                  fill={isSelected ? 'rgba(56,189,248,0.15)' : 'rgba(148,163,184,0.06)'}
                                  stroke={isSelected ? 'rgba(56,189,248,0.95)' : 'rgba(148,163,184,0.6)'}
                                  strokeWidth={isSelected ? 3 : 2}
                                />
                                {layers.labels ? (
                                  <text x={roomShape.x + 10} y={roomShape.y + 20} fill="rgba(226,232,240,0.95)" fontSize="14" fontWeight="600">
                                    {room.name || room.roomId}
                                  </text>
                                ) : null}
                                {roomHandles
                                  ? (Object.entries(roomHandles) as Array<[ResizeHandle, Point]>).map(
                                      ([handle, point]) => (
                                        <circle
                                          key={`${room.roomId}-${handle}`}
                                          cx={point.x}
                                          cy={point.y}
                                          r={6}
                                          fill="white"
                                          stroke="rgba(2,6,23,0.95)"
                                          strokeWidth={1.5}
                                          onMouseDown={(event) => handleRoomResizeMouseDown(event, room, handle)}
                                          onClick={(event) => event.stopPropagation()}
                                        />
                                      ),
                                    )
                                  : null}
                              </g>
                            )
                          })
                        : null}

                      {layers.seats
                        ? floorSeats(activeFloor).map((seat) => {
                            const seatShape = previewSeatShape(seat)
                            const selected = selection.seatIds.includes(seat.seatId)
                            const fill = seat.isDisabled ? 'rgba(100,116,139,0.8)' : segmentColor(seat.segmentId)
                            const seatHandles =
                              selected && selection.seatIds.length === 1 && tool === 'select'
                                ? resizeHandlePoints(seatShape)
                                : null
                            return (
                              <g
                                key={seat.seatId}
                                onMouseDown={(event) => handleSeatMouseDown(event, seat)}
                                onClick={(event) => handleSeatClick(event, seat)}
                              >
                                <rect
                                  x={seatShape.x}
                                  y={seatShape.y}
                                  width={seatShape.w}
                                  height={seatShape.h}
                                  rx={6}
                                  fill={fill}
                                  stroke={selected ? 'rgba(255,255,255,0.98)' : 'rgba(2,6,23,0.9)'}
                                  strokeWidth={selected ? 2.5 : 1.4}
                                />
                                {seat.isDisabled ? (
                                  <>
                                    <line x1={seatShape.x + 3} y1={seatShape.y + 3} x2={seatShape.x + seatShape.w - 3} y2={seatShape.y + seatShape.h - 3} stroke="rgba(15,23,42,0.95)" strokeWidth={1.4} />
                                    <line x1={seatShape.x + seatShape.w - 3} y1={seatShape.y + 3} x2={seatShape.x + 3} y2={seatShape.y + seatShape.h - 3} stroke="rgba(15,23,42,0.95)" strokeWidth={1.4} />
                                  </>
                                ) : null}
                                {layers.labels ? (
                                  <text x={seatShape.x + seatShape.w / 2} y={seatShape.y + seatShape.h / 2 + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="700">
                                    {seat.label}
                                  </text>
                                ) : null}
                                {seatHandles
                                  ? (Object.entries(seatHandles) as Array<[ResizeHandle, Point]>).map(
                                      ([handle, point]) => (
                                        <circle
                                          key={`${seat.seatId}-${handle}`}
                                          cx={point.x}
                                          cy={point.y}
                                          r={4}
                                          fill="white"
                                          stroke="rgba(2,6,23,0.95)"
                                          strokeWidth={1.2}
                                          onMouseDown={(event) => handleSeatResizeMouseDown(event, seat, handle)}
                                          onClick={(event) => event.stopPropagation()}
                                        />
                                      ),
                                    )
                                  : null}
                              </g>
                            )
                          })
                        : null}

                      {marqueeRect ? (
                        <g pointerEvents="none">
                          <rect
                            x={marqueeRect.x}
                            y={marqueeRect.y}
                            width={marqueeRect.w}
                            height={marqueeRect.h}
                            fill="rgba(56,189,248,0.12)"
                            stroke="rgba(56,189,248,0.95)"
                            strokeDasharray="8 6"
                            strokeWidth={2}
                            rx={4}
                          />
                        </g>
                      ) : null}
                    </svg>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={() => nudgeSelection(-gridStep, 0)} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>← Nudge</button>
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={() => nudgeSelection(gridStep, 0)} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>Nudge →</button>
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={() => nudgeSelection(0, -gridStep)} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>↑ Nudge</button>
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={() => nudgeSelection(0, gridStep)} disabled={disabled || (selection.seatIds.length === 0 && !selection.roomId)}>↓ Nudge</button>
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">Draft has no floors.</p>
            )}
          </section>

          <aside className="panel-strong space-y-4 p-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Properties</p>
              {selectedRoom ? (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-[var(--muted)]">Selected room</p>
                  <label className="flex flex-col gap-1 text-xs">
                    Name
                    <input className="panel rounded-lg px-2 py-2 text-sm" value={selectedRoom.name} onChange={(e) => updateSelectedRoom((room) => { room.name = e.target.value })} disabled={disabled} />
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1">X<input className="panel rounded px-2 py-1" type="number" value={selectedRoom.shape.x} onChange={(e) => updateSelectedRoom((room) => { room.shape.x = Number(e.target.value) || 0 })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">Y<input className="panel rounded px-2 py-1" type="number" value={selectedRoom.shape.y} onChange={(e) => updateSelectedRoom((room) => { room.shape.y = Number(e.target.value) || 0 })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">W<input className="panel rounded px-2 py-1" type="number" min={20} value={selectedRoom.shape.w} onChange={(e) => updateSelectedRoom((room) => { room.shape.w = Math.max(20, Number(e.target.value) || 20) })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">H<input className="panel rounded px-2 py-1" type="number" min={20} value={selectedRoom.shape.h} onChange={(e) => updateSelectedRoom((room) => { room.shape.h = Math.max(20, Number(e.target.value) || 20) })} disabled={disabled} /></label>
                  </div>
                </div>
              ) : selectedSeats.length === 1 ? (
                <div className="space-y-2 text-sm">
                  <p className="text-xs text-[var(--muted)]">Selected seat</p>
                  <label className="flex flex-col gap-1 text-xs">Label<input className="panel rounded-lg px-2 py-2 text-sm" value={selectedSeats[0].label} onChange={(e) => updateSelectedSeat((seat) => { seat.label = e.target.value })} disabled={disabled} /></label>
                  <label className="flex flex-col gap-1 text-xs">Segment
                    <select className="panel rounded-lg px-2 py-2 text-sm" value={selectedSeats[0].segmentId ?? ''} onChange={(e) => updateSelectedSeat((seat) => { seat.segmentId = e.target.value || undefined })} disabled={disabled}>
                      <option value="">Unassigned</option>
                      {segmentOptions.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(selectedSeats[0].isDisabled)} onChange={(e) => updateSelectedSeat((seat) => { seat.isDisabled = e.target.checked; if (!e.target.checked) delete seat.disableReason })} disabled={disabled} /> Disabled</label>
                  {selectedSeats[0].isDisabled ? (
                    <label className="flex flex-col gap-1 text-xs">Disable reason<input className="panel rounded-lg px-2 py-2 text-sm" value={selectedSeats[0].disableReason ?? ''} onChange={(e) => updateSelectedSeat((seat) => { seat.disableReason = e.target.value || undefined })} disabled={disabled} /></label>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1">X<input className="panel rounded px-2 py-1" type="number" value={selectedSeats[0].shape.x} onChange={(e) => updateSelectedSeat((seat) => { seat.shape.x = Number(e.target.value) || 0 })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">Y<input className="panel rounded px-2 py-1" type="number" value={selectedSeats[0].shape.y} onChange={(e) => updateSelectedSeat((seat) => { seat.shape.y = Number(e.target.value) || 0 })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">W<input className="panel rounded px-2 py-1" type="number" min={12} value={selectedSeats[0].shape.w} onChange={(e) => updateSelectedSeat((seat) => { seat.shape.w = Math.max(12, Number(e.target.value) || 12) })} disabled={disabled} /></label>
                    <label className="flex flex-col gap-1">H<input className="panel rounded px-2 py-1" type="number" min={12} value={selectedSeats[0].shape.h} onChange={(e) => updateSelectedSeat((seat) => { seat.shape.h = Math.max(12, Number(e.target.value) || 12) })} disabled={disabled} /></label>
                  </div>
                  <p className="text-xs text-[var(--muted)]">Seat ID: {selectedSeats[0].seatId}</p>
                </div>
              ) : selectedSeats.length > 1 ? (
                <div className="space-y-3 text-sm">
                  <p className="text-xs text-[var(--muted)]">{selectedSeats.length} seats selected</p>
                  <label className="flex flex-col gap-1 text-xs">Assign segment
                    <select className="panel rounded-lg px-2 py-2 text-sm" value="" onChange={(e) => { assignSegmentToSelected(e.target.value); e.currentTarget.value = '' }} disabled={disabled}>
                      <option value="">Choose segment</option>
                      {segmentOptions.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
                    </select>
                  </label>

                  <div className="space-y-2 rounded-lg border border-[var(--border)] p-2">
                    <p className="text-xs font-medium">Auto-number</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex flex-col gap-1">Row mode
                        <select className="panel rounded px-2 py-1" value={autoNumber.rowPrefixMode} onChange={(e) => setAutoNumber((cur) => ({ ...cur, rowPrefixMode: e.target.value as AutoNumberState['rowPrefixMode'] }))}>
                          <option value="alpha">A, B, C</option>
                          <option value="numeric">1, 2, 3</option>
                        </select>
                      </label>
                      {autoNumber.rowPrefixMode === 'alpha' ? (
                        <label className="flex flex-col gap-1">Row start
                          <input className="panel rounded px-2 py-1" value={autoNumber.rowStart} maxLength={1} onChange={(e) => setAutoNumber((cur) => ({ ...cur, rowStart: (e.target.value || 'A').slice(0, 1).toUpperCase() }))} />
                        </label>
                      ) : (
                        <label className="flex flex-col gap-1">Row start
                          <input className="panel rounded px-2 py-1" type="number" value={autoNumber.rowNumberStart} onChange={(e) => setAutoNumber((cur) => ({ ...cur, rowNumberStart: Number(e.target.value) || 1 }))} />
                        </label>
                      )}
                      <label className="flex flex-col gap-1">Seat start
                        <input className="panel rounded px-2 py-1" type="number" value={autoNumber.seatStartNumber} onChange={(e) => setAutoNumber((cur) => ({ ...cur, seatStartNumber: Number(e.target.value) || 1 }))} />
                      </label>
                      <label className="flex flex-col gap-1">Pad
                        <input className="panel rounded px-2 py-1" type="number" min={1} max={4} value={autoNumber.pad} onChange={(e) => setAutoNumber((cur) => ({ ...cur, pad: clamp(Number(e.target.value) || 2, 1, 4) }))} />
                      </label>
                      <label className="flex flex-col gap-1">Row inc
                        <input className="panel rounded px-2 py-1" type="number" min={1} value={autoNumber.rowIncrement} onChange={(e) => setAutoNumber((cur) => ({ ...cur, rowIncrement: Math.max(1, Number(e.target.value) || 1) }))} />
                      </label>
                      <label className="flex flex-col gap-1">Direction
                        <select className="panel rounded px-2 py-1" value={autoNumber.direction} onChange={(e) => setAutoNumber((cur) => ({ ...cur, direction: e.target.value as AutoNumberState['direction'] }))}>
                          <option value="ltr">Left → Right</option>
                          <option value="rtl">Right → Left</option>
                        </select>
                      </label>
                    </div>
                    <div className="rounded border border-[var(--border)] p-2 text-xs">
                      <p className="font-medium text-[var(--muted)]">Preview (first {autoNumberPreview.length})</p>
                      <div className="mt-1 space-y-1">
                        {autoNumberPreview.length > 0 ? autoNumberPreview.map((item) => (
                          <p key={item.seatId}><span className="text-[var(--muted)]">{item.from}</span> → {item.to}</p>
                        )) : <p className="text-[var(--muted)]">No seats selected.</p>}
                      </div>
                    </div>
                    <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50" onClick={autoNumberSelectedSeats} disabled={disabled || selectedSeats.length === 0}>Apply Auto-number</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm text-[var(--muted)]">
                  <p>Select a room or seat to edit properties.</p>
                  <p>Shift+click to multi-select seats.</p>
                  <p>Keyboard: Cmd/Ctrl+Z, Cmd/Ctrl+Y, Delete, Cmd/Ctrl+C/V.</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Segments Coverage</p>
              {seatCountBySegment.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No seats yet.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  {seatCountBySegment.map((row) => {
                    const segment = row.segmentId === '__missing__' ? null : segments.find((s) => s.id === row.segmentId)
                    return (
                      <div key={row.segmentId} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1">
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: row.segmentId === '__missing__' ? 'rgba(250,204,21,0.85)' : segmentColor(row.segmentId) }} />
                          {row.segmentId === '__missing__' ? 'Unassigned' : segment?.name ?? row.segmentId}
                        </span>
                        <span>{row.count}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {segments.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-300">
                  No segments configured yet. Create segments in Pricing first, then assign them here.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Validation</p>
                <span className={`text-xs ${canPublishBasedOnValidation ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                  {canPublishBasedOnValidation ? 'Publish can proceed' : 'Publish blocked'}
                </span>
              </div>
              <div className="max-h-72 space-y-2 overflow-auto">
                {validationIssues.length === 0 ? (
                  <p className="rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-2 text-xs">
                    No validation issues detected for current draft.
                  </p>
                ) : (
                  validationIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className={`rounded border px-2 py-2 text-xs ${
                        issue.level === 'error'
                          ? 'border-red-400/30 bg-red-500/10'
                          : 'border-amber-400/30 bg-amber-500/10'
                      } ${validationFocusToken === issue.id ? 'ring-1 ring-[var(--accent)]' : ''}`}
                    >
                      <p>{issue.message}</p>
                      {(issue.seatIds?.length || issue.roomIds?.length) ? (
                        <button type="button" className="mt-1 rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10" onClick={() => selectIssue(issue)}>
                          Fix / Select
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      <details className="panel-strong p-4" open={showAdvanced} onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm font-medium">More → Advanced (JSON)</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowJsonEdit} onChange={(e) => setAllowJsonEdit(e.target.checked)} />
              Allow JSON edit (advanced)
            </label>
            <button type="button" className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10 disabled:opacity-50" onClick={formatJson} disabled={!allowJsonEdit || disabled}>
              Format JSON
            </button>
          </div>
          <textarea
            className="panel min-h-[240px] w-full rounded-lg px-3 py-2 font-mono text-xs"
            value={editorText}
            onChange={(event) => {
              if (!allowJsonEdit) return
              setEditorText(event.target.value)
              onDraftTextChange(event.target.value)
            }}
            readOnly={!allowJsonEdit}
            spellCheck={false}
          />
        </div>
      </details>
    </div>
  )
}
