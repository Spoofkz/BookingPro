'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AccountSettingsSection from '@/src/components/account/AccountSettingsSection'
import FinanceInvoicesSection from '@/src/components/cabinet/FinanceInvoicesSection'
import HostCustomersSection from '@/src/components/cabinet/HostCustomersSection'

type Booking = {
  id: number
  guestName: string
  guestEmail: string
  status: string
  paymentStatus: string
  slotId: string | null
  seatId: string | null
  seatLabelSnapshot: string | null
  checkIn: string
  checkOut: string
  room: {
    id: number
    name: string
  }
}

type PaymentItem = {
  id: number
  amountCents: number
  method: string
  status: string
  createdAt: string
  bookingId: number
}

type SlotItem = {
  slotId: string
  startAt: string
  endAt: string
  status: 'PUBLISHED' | 'BLOCKED' | 'CANCELLED_LOCKED'
}

type PublishedSeat = {
  seatId: string
  floorId: string
  roomId: string | null
  segmentId: string
  label: string
  isDisabled: boolean
  geometry?: RectGeometry | null
}

type AvailabilitySeat = {
  seatId: string
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'DISABLED'
  holdExpiresAt?: string
  bookingId?: number
}

type MeResponse = {
  activeClubId: string | null
}

type RectGeometry = {
  type: 'rect'
  x: number
  y: number
  w: number
  h: number
  rotation?: number
}

type FloorLayout = {
  floorId: string
  name: string
  plane: { width: number; height: number }
  background?: {
    type: 'image'
    url: string
    width: number
    height: number
    opacity?: number
  }
  rooms: Array<{
    roomId: string
    name: string
    shape: RectGeometry
  }>
}

type VisualSeatRow = {
  seatId: string
  label: string
  segmentId: string
  roomId: string | null
  geometry: RectGeometry
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'DISABLED'
  holdExpiresAt?: string
  bookingId?: number
}

type BookingFilters = {
  status: string
  date: string
  query: string
}

type BookingScope = 'CURRENT_UPCOMING' | 'TODAY' | 'ALL'

const ACTIVE_BOOKING_STATUSES = new Set(['HELD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'])

function todayDateInput() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string; code?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

function formatDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function asRectGeometry(value: unknown): RectGeometry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'rect') return null
  const x = typeof raw.x === 'number' ? raw.x : null
  const y = typeof raw.y === 'number' ? raw.y : null
  const w = typeof raw.w === 'number' ? raw.w : null
  const h = typeof raw.h === 'number' ? raw.h : null
  const rotation = typeof raw.rotation === 'number' ? raw.rotation : 0
  if (x == null || y == null || w == null || h == null) return null
  return { type: 'rect', x, y, w, h, rotation }
}

function seatStatusClass(status: string) {
  if (status === 'AVAILABLE') return 'text-emerald-700 dark:text-emerald-300'
  if (status === 'HELD') return 'text-amber-700 dark:text-amber-300'
  if (status === 'BOOKED') return 'text-rose-700 dark:text-rose-300'
  return 'text-slate-700 dark:text-slate-300'
}

function seatStatusFill(status: string) {
  if (status === 'AVAILABLE') return '#10b981'
  if (status === 'HELD') return '#f59e0b'
  if (status === 'BOOKED') return '#ef4444'
  if (status === 'DISABLED') return '#64748b'
  return '#94a3b8'
}

export default function HostSection({ section }: { section: string }) {
  const knownSections = new Set([
    'today',
    'bookings',
    'live-map',
    'customers',
    'payments',
    'support',
    'account',
  ])
  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [payments, setPayments] = useState<PaymentItem[]>([])
  const [slotDate, setSlotDate] = useState(todayDateInput())
  const [slots, setSlots] = useState<SlotItem[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState('')
  const [publishedSeats, setPublishedSeats] = useState<PublishedSeat[]>([])
  const [mapFloorLayouts, setMapFloorLayouts] = useState<FloorLayout[]>([])
  const [selectedFloorId, setSelectedFloorId] = useState('')
  const [availabilitySeats, setAvailabilitySeats] = useState<AvailabilitySeat[]>([])
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [filters, setFilters] = useState<BookingFilters>({
    status: '',
    date: '',
    query: '',
  })
  const [bookingScope, setBookingScope] = useState<BookingScope>('CURRENT_UPCOMING')
  const [seatMoveBookingId, setSeatMoveBookingId] = useState<string>('')
  const [seatMoveTargetSeatId, setSeatMoveTargetSeatId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyBookingId, setBusyBookingId] = useState<number | null>(null)

  async function fetchClub<T>(path: string, fallbackError: string, init?: RequestInit) {
    if (!activeClubId) {
      throw new Error('Active club context is required.')
    }
    const headers = new Headers(init?.headers)
    headers.set('X-Club-Id', activeClubId)
    const response = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers,
    })
    return readJson<T>(response, fallbackError)
  }

  async function loadPublishedSeats(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/seats?mapVersion=latest`, {
      cache: 'no-store',
      headers: { 'X-Club-Id': clubId },
    })
    const payload = await readJson<{
      floors?: Array<{
        floorId: string
        name: string
        plane: { width: number; height: number }
        background?: FloorLayout['background'] | null
        rooms?: Array<{
          roomId: string
          name: string
          shape: unknown
        }>
      }>
      seats: Array<{
        seatId: string
        floorId: string
        roomId: string | null
        segmentId: string
        label: string
        isDisabled: boolean
        geometry?: unknown
      }>
    }>(response, 'Failed to load published seats.')
    const seats = (payload.seats || []).map((seat) => ({
      ...seat,
      geometry: asRectGeometry(seat.geometry),
    }))
    setPublishedSeats(seats)

    const floors = (payload.floors || []).reduce<FloorLayout[]>((acc, floor) => {
      const width = typeof floor.plane?.width === 'number' ? floor.plane.width : 0
      const height = typeof floor.plane?.height === 'number' ? floor.plane.height : 0
      if (!floor.floorId || width <= 0 || height <= 0) return acc
      const rooms: FloorLayout['rooms'] = []
      for (const room of floor.rooms || []) {
        const shape = asRectGeometry(room.shape)
        if (!shape || !room.roomId) continue
        rooms.push({
          roomId: room.roomId,
          name: room.name || room.roomId,
          shape,
        })
      }
      acc.push({
        floorId: floor.floorId,
        name: floor.name || floor.floorId,
        plane: { width, height },
        background: floor.background ?? undefined,
        rooms,
      })
      return acc
    }, [])
    setMapFloorLayouts(floors)

    const floorIds = Array.from(new Set(seats.map((seat) => seat.floorId))).sort((a, b) =>
      a.localeCompare(b),
    )
    setSelectedFloorId((current) => (current && floorIds.includes(current) ? current : floorIds[0] || ''))
  }

  async function loadSlotsForDate(clubId: string, date: string) {
    const response = await fetch(`/api/clubs/${clubId}/slots?date=${encodeURIComponent(date)}`, {
      cache: 'no-store',
      headers: { 'X-Club-Id': clubId },
    })
    const payload = await readJson<{ items: SlotItem[] }>(response, 'Failed to load slots.')
    const items = payload.items || []
    setSlots(items)
    setSelectedSlotId((current) => {
      if (current && items.some((slot) => slot.slotId === current)) return current
      const firstPublished = items.find((slot) => slot.status === 'PUBLISHED')
      return firstPublished?.slotId || items[0]?.slotId || ''
    })
  }

  async function loadFloorAvailability(clubId: string, slotId: string, floorId: string) {
    setAvailabilityBusy(true)
    try {
      const response = await fetch(
        `/api/clubs/${clubId}/availability?slotId=${encodeURIComponent(slotId)}&floorId=${encodeURIComponent(floorId)}`,
        {
          cache: 'no-store',
          headers: { 'X-Club-Id': clubId },
        },
      )
      const payload = await readJson<{ seats: AvailabilitySeat[] }>(
        response,
        'Failed to load seat availability.',
      )
      setAvailabilitySeats(payload.seats || [])
    } finally {
      setAvailabilityBusy(false)
    }
  }

  const loadContextAndData = useCallback(async () => {
    const meResponse = await fetch('/api/me', { cache: 'no-store' })
    const me = await readJson<MeResponse>(meResponse, 'Failed to load user context.')
    setActiveClubId(me.activeClubId)
    if (!me.activeClubId) {
      setBookings([])
      setPayments([])
      setSlots([])
      setSelectedSlotId('')
      setPublishedSeats([])
      setMapFloorLayouts([])
      setSelectedFloorId('')
      setAvailabilitySeats([])
      return
    }

    const [bookingsResponse, paymentsResponse] = await Promise.all([
      fetch('/api/bookings?scope=club&pageSize=200', {
        cache: 'no-store',
        headers: { 'X-Club-Id': me.activeClubId },
      }),
      fetch('/api/payments?scope=club&pageSize=100', {
        cache: 'no-store',
        headers: { 'X-Club-Id': me.activeClubId },
      }),
    ])

    const bookingData = await readJson<{ items: Booking[] }>(
      bookingsResponse,
      'Failed to load bookings.',
    )
    const paymentData = await readJson<{ items: PaymentItem[] }>(
      paymentsResponse,
      'Failed to load payments.',
    )

    setBookings(bookingData.items)
    setPayments(paymentData.items)
    await Promise.all([
      loadPublishedSeats(me.activeClubId),
      loadSlotsForDate(me.activeClubId, slotDate),
    ])
  }, [slotDate])

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        await loadContextAndData()
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load host cabinet.')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [loadContextAndData])

  useEffect(() => {
    if (!activeClubId) return
    const clubId = activeClubId
    let cancelled = false
    async function refreshSlots() {
      try {
        await loadSlotsForDate(clubId, slotDate)
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Failed to load slots.')
        }
      }
    }
    void refreshSlots()
    return () => {
      cancelled = true
    }
  }, [activeClubId, slotDate])

  useEffect(() => {
    if (section !== 'live-map') return
    if (!activeClubId || !selectedSlotId || !selectedFloorId) {
      setAvailabilitySeats([])
      return
    }
    const clubId = activeClubId

    let cancelled = false
    async function refreshAvailability() {
      try {
        await loadFloorAvailability(clubId, selectedSlotId, selectedFloorId)
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : 'Failed to load seat availability.')
        }
      }
    }

    void refreshAvailability()
    const timer = window.setInterval(() => {
      void refreshAvailability()
    }, 5_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeClubId, section, selectedFloorId, selectedSlotId])

  async function runBookingAction(
    bookingId: number,
    action: 'check_in' | 'check_out' | 'cancel' | 'mark_paid' | 'move_seat',
    extras?: Record<string, unknown>,
  ) {
    setBusyBookingId(bookingId)
    setError(null)
    setMessage(null)
    try {
      const response = await fetchClub<Booking>(`/api/bookings/${bookingId}`, 'Failed to update booking.', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extras }),
      })
      setBookings((current) =>
        current.map((booking) => (booking.id === bookingId ? response : booking)),
      )
      if (action === 'mark_paid') {
        await loadContextAndData()
      }
      setMessage(`Booking #${bookingId} updated (${action}).`)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to update booking.')
    } finally {
      setBusyBookingId(null)
    }
  }

  async function handleLiveSeatMove() {
    const bookingId = Number(seatMoveBookingId)
    if (!Number.isInteger(bookingId) || bookingId < 1) {
      setError('Select source booking before moving seat.')
      return
    }
    if (!seatMoveTargetSeatId) {
      setError('Select target seat before moving booking.')
      return
    }
    await runBookingAction(bookingId, 'move_seat', {
      newSeatId: seatMoveTargetSeatId,
    })
    if (activeClubId && selectedSlotId && selectedFloorId) {
      await loadFloorAvailability(activeClubId, selectedSlotId, selectedFloorId)
    }
  }

  const filteredBookings = useMemo(() => {
    const nowMs = Date.now()
    const today = todayDateInput()
    const items = bookings.filter((booking) => {
      const checkOutMs = new Date(booking.checkOut).getTime()
      const bookingDate = new Date(booking.checkIn).toISOString().slice(0, 10)

      if (bookingScope === 'CURRENT_UPCOMING') {
        if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return false
        if (checkOutMs < nowMs - 15 * 60 * 1000) return false
      } else if (bookingScope === 'TODAY') {
        if (bookingDate !== today) return false
        if (booking.status === 'COMPLETED' || booking.status === 'CANCELED') return false
      }

      if (filters.status && booking.status !== filters.status) return false
      if (filters.date) {
        if (bookingDate !== filters.date) return false
      }
      if (filters.query.trim()) {
        const query = filters.query.trim().toLowerCase()
        const searchable = `${booking.guestName} ${booking.guestEmail} ${booking.room.name}`.toLowerCase()
        if (!searchable.includes(query)) return false
      }
      return true
    })
    items.sort((left, right) => {
      const leftStart = new Date(left.checkIn).getTime()
      const rightStart = new Date(right.checkIn).getTime()
      return leftStart - rightStart
    })
    return items
  }, [bookingScope, bookings, filters.date, filters.query, filters.status])

  const bookingScopeCounts = useMemo(() => {
    const nowMs = Date.now()
    const today = todayDateInput()
    return {
      currentUpcoming: bookings.filter((booking) => {
        if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return false
        return new Date(booking.checkOut).getTime() >= nowMs - 15 * 60 * 1000
      }).length,
      today: bookings.filter((booking) => {
        const bookingDate = new Date(booking.checkIn).toISOString().slice(0, 10)
        return bookingDate === today && booking.status !== 'COMPLETED' && booking.status !== 'CANCELED'
      }).length,
      all: bookings.length,
    }
  }, [bookings])

  const metrics = useMemo(() => {
    const today = todayDateInput()
    const todayBookings = bookings.filter(
      (booking) => new Date(booking.checkIn).toISOString().slice(0, 10) === today,
    )
    return {
      total: todayBookings.length,
      checkedIn: todayBookings.filter((booking) => booking.status === 'CHECKED_IN').length,
      pendingPayments: todayBookings.filter((booking) => booking.paymentStatus !== 'PAID').length,
      active: todayBookings.filter((booking) =>
        ['HELD', 'PENDING', 'CONFIRMED', 'CHECKED_IN'].includes(booking.status),
      ).length,
    }
  }, [bookings])

  const floorOptions = useMemo(
    () =>
      Array.from(new Set(publishedSeats.map((seat) => seat.floorId))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [publishedSeats],
  )

  const floorSeatsById = useMemo(() => {
    const floorSeats = publishedSeats.filter((seat) => seat.floorId === selectedFloorId)
    return new Map(floorSeats.map((seat) => [seat.seatId, seat]))
  }, [publishedSeats, selectedFloorId])

  const selectedFloorLayout = useMemo(
    () => mapFloorLayouts.find((floor) => floor.floorId === selectedFloorId) ?? null,
    [mapFloorLayouts, selectedFloorId],
  )

  const liveRows = useMemo(() => {
    return availabilitySeats
      .map((seat) => ({
        ...seat,
        label: floorSeatsById.get(seat.seatId)?.label || seat.seatId,
        segmentId: floorSeatsById.get(seat.seatId)?.segmentId || '',
        roomId: floorSeatsById.get(seat.seatId)?.roomId || null,
        geometry: floorSeatsById.get(seat.seatId)?.geometry || null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [availabilitySeats, floorSeatsById])

  const bookingById = useMemo(
    () => new Map(bookings.map((booking) => [booking.id, booking])),
    [bookings],
  )

  const movableBookingsForSlot = useMemo(() => {
    const rows = liveRows
      .filter((seat) => seat.status === 'BOOKED' && typeof seat.bookingId === 'number')
      .map((seat) => {
        const booking = bookingById.get(seat.bookingId as number)
        if (!booking) return null
        if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) return null
        return {
          bookingId: booking.id,
          seatId: seat.seatId,
          seatLabel: seat.label,
          booking,
        }
      })
      .filter(
        (
          value,
        ): value is {
          bookingId: number
          seatId: string
          seatLabel: string
          booking: Booking
        } => Boolean(value),
      )
      .sort((left, right) => left.booking.checkIn.localeCompare(right.booking.checkIn))

    return Array.from(new Map(rows.map((item) => [item.bookingId, item])).values())
  }, [bookingById, liveRows])

  const targetSeatOptions = useMemo(
    () => liveRows.filter((seat) => seat.status === 'AVAILABLE'),
    [liveRows],
  )

  const selectedSourceBooking = useMemo(
    () =>
      movableBookingsForSlot.find(
        (item) => String(item.bookingId) === seatMoveBookingId,
      ) ?? null,
    [movableBookingsForSlot, seatMoveBookingId],
  )

  useEffect(() => {
    if (!seatMoveBookingId) return
    const exists = movableBookingsForSlot.some(
      (item) => String(item.bookingId) === seatMoveBookingId,
    )
    if (!exists) {
      setSeatMoveBookingId('')
    }
  }, [movableBookingsForSlot, seatMoveBookingId])

  useEffect(() => {
    if (!seatMoveTargetSeatId) return
    const exists = targetSeatOptions.some((seat) => seat.seatId === seatMoveTargetSeatId)
    if (!exists) {
      setSeatMoveTargetSeatId('')
    }
  }, [seatMoveTargetSeatId, targetSeatOptions])

  const availabilityBySeatId = useMemo(
    () => new Map(availabilitySeats.map((seat) => [seat.seatId, seat])),
    [availabilitySeats],
  )

  const visualSeatRows = useMemo<VisualSeatRow[]>(() => {
    const floorSeats = publishedSeats.filter((seat) => seat.floorId === selectedFloorId)
    const rows: VisualSeatRow[] = []
    for (const seat of floorSeats) {
      if (!seat.geometry) continue
      const overlay = availabilityBySeatId.get(seat.seatId)
      rows.push({
        seatId: seat.seatId,
        label: seat.label,
        segmentId: seat.segmentId,
        roomId: seat.roomId,
        geometry: seat.geometry,
        status: overlay?.status ?? (seat.isDisabled ? 'DISABLED' : 'AVAILABLE'),
        holdExpiresAt: overlay?.holdExpiresAt,
        bookingId: overlay?.bookingId,
      })
    }
    rows.sort((a, b) => a.label.localeCompare(b.label))
    return rows
  }, [availabilityBySeatId, publishedSeats, selectedFloorId])

  const liveCounts = useMemo(() => {
    const counts = {
      AVAILABLE: 0,
      HELD: 0,
      BOOKED: 0,
      DISABLED: 0,
    }
    for (const seat of availabilitySeats) {
      counts[seat.status] += 1
    }
    return counts
  }, [availabilitySeats])

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading host operations...</p>
  }

  if (!activeClubId && section !== 'account') {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Host Cabinet</h2>
        <p className="text-sm text-[var(--muted)]">
          Select an active club in the cabinet header to use host tools.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Host Cabinet</h2>
        <article className="panel-strong rounded-lg border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
          <p>{error}</p>
          <button
            type="button"
            className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </article>
      </div>
    )
  }

  if (!knownSections.has(section)) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Access denied</h2>
        <p className="text-sm text-[var(--muted)]">
          This host section is unavailable for your current capabilities.
        </p>
      </div>
    )
  }

  if (section === 'account') {
    return (
      <AccountSettingsSection
        heading="Host Account"
        subtitle="Manage your login, personal info, phone/email verification, and password."
      />
    )
  }

  if (section === 'bookings') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Bookings</h2>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className={`rounded-lg border px-3 py-1 ${
              bookingScope === 'CURRENT_UPCOMING'
                ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]'
                : 'border-[var(--border)] hover:bg-white/10'
            }`}
            onClick={() => setBookingScope('CURRENT_UPCOMING')}
          >
            Current & Upcoming ({bookingScopeCounts.currentUpcoming})
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-1 ${
              bookingScope === 'TODAY'
                ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]'
                : 'border-[var(--border)] hover:bg-white/10'
            }`}
            onClick={() => setBookingScope('TODAY')}
          >
            Today ({bookingScopeCounts.today})
          </button>
          <button
            type="button"
            className={`rounded-lg border px-3 py-1 ${
              bookingScope === 'ALL'
                ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]'
                : 'border-[var(--border)] hover:bg-white/10'
            }`}
            onClick={() => setBookingScope('ALL')}
          >
            All ({bookingScopeCounts.all})
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Date
            <input
              type="date"
              className="panel rounded-lg px-3 py-2"
              value={filters.date}
              onChange={(event) =>
                setFilters((current) => ({ ...current, date: event.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              className="panel rounded-lg px-3 py-2"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">All</option>
              <option value="HELD">HELD</option>
              <option value="PENDING">PENDING</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="CHECKED_IN">CHECKED_IN</option>
              <option value="CANCELED">CANCELED</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="NO_SHOW">NO_SHOW</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Seat/Customer
            <input
              className="panel rounded-lg px-3 py-2"
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Name, email or room"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10"
            onClick={() =>
              setFilters((current) => ({
                ...current,
                date: todayDateInput(),
              }))
            }
          >
            Today
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10"
            onClick={() =>
              setFilters((current) => ({
                ...current,
                date: '',
              }))
            }
          >
            All dates
          </button>
          <span className="rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--muted)]">
            Showing {filteredBookings.length} / {bookings.length}
          </span>
        </div>

        {filteredBookings.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No bookings match current filters.</p>
        ) : (
          <div className="space-y-3">
            {filteredBookings.map((booking) => {
              return (
                <article key={booking.id} className="panel-strong space-y-2 p-3 text-sm">
                  <p className="font-medium">
                    #{booking.id} · {booking.room.name} · {booking.guestName}
                  </p>
                  <p className="text-[var(--muted)]">{booking.guestEmail}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {formatDateRange(booking.checkIn, booking.checkOut)}
                  </p>
                  <p className="text-xs">
                    {booking.status} · payment {booking.paymentStatus}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      disabled={busyBookingId === booking.id}
                      onClick={() => void runBookingAction(booking.id, 'check_in')}
                    >
                      Check-in
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      disabled={busyBookingId === booking.id}
                      onClick={() => void runBookingAction(booking.id, 'check_out')}
                    >
                      Check-out
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      disabled={busyBookingId === booking.id}
                      onClick={() => void runBookingAction(booking.id, 'cancel')}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      disabled={busyBookingId === booking.id || booking.paymentStatus === 'PAID'}
                      onClick={() => void runBookingAction(booking.id, 'mark_paid')}
                    >
                      Mark paid
                    </button>
                    <span className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]">
                      Seat move is handled in Live Map (seat-to-seat only).
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (section === 'live-map') {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Live Map</h2>
        {publishedSeats.length === 0 ? (
          <article className="panel-strong p-4 text-sm text-[var(--muted)]">
            Published map seats are not available yet. Publish map and schedule first.
          </article>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Date
                <input
                  type="date"
                  className="panel rounded-lg px-3 py-2"
                  value={slotDate}
                  onChange={(event) => setSlotDate(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Slot
                <select
                  className="panel rounded-lg px-3 py-2"
                  value={selectedSlotId}
                  onChange={(event) => setSelectedSlotId(event.target.value)}
                >
                  {slots.length === 0 ? <option value="">No slots</option> : null}
                  {slots.map((slot) => (
                    <option key={slot.slotId} value={slot.slotId}>
                      {new Date(slot.startAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      -{' '}
                      {new Date(slot.endAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      ({slot.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Floor
                <select
                  className="panel rounded-lg px-3 py-2"
                  value={selectedFloorId}
                  onChange={(event) => setSelectedFloorId(event.target.value)}
                >
                  {floorOptions.length === 0 ? <option value="">No floors</option> : null}
                  {floorOptions.map((floorId) => (
                    <option key={floorId} value={floorId}>
                      {floorId}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 self-end"
                disabled={!activeClubId || !selectedSlotId || !selectedFloorId || availabilityBusy}
                onClick={() => {
                  if (!activeClubId || !selectedSlotId || !selectedFloorId) return
                  void loadFloorAvailability(activeClubId, selectedSlotId, selectedFloorId)
                }}
              >
                {availabilityBusy ? 'Refreshing...' : 'Refresh overlay'}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <article className="panel-strong p-3 text-sm">
                <p className="text-xs text-[var(--muted)]">Available</p>
                <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
                  {liveCounts.AVAILABLE}
                </p>
              </article>
              <article className="panel-strong p-3 text-sm">
                <p className="text-xs text-[var(--muted)]">Held</p>
                <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">
                  {liveCounts.HELD}
                </p>
              </article>
              <article className="panel-strong p-3 text-sm">
                <p className="text-xs text-[var(--muted)]">Booked</p>
                <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">
                  {liveCounts.BOOKED}
                </p>
              </article>
              <article className="panel-strong p-3 text-sm">
                <p className="text-xs text-[var(--muted)]">Disabled</p>
                <p className="text-xl font-semibold text-slate-700 dark:text-slate-300">
                  {liveCounts.DISABLED}
                </p>
              </article>
            </div>

            <article className="panel-strong space-y-3 p-4">
              <div>
                <h3 className="text-sm font-semibold">Seat Move Tool</h3>
                <p className="text-xs text-[var(--muted)]">
                  Seat move is now seat-to-seat only. Select a booked source and an available target seat.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  Source Booking
                  <select
                    className="panel rounded-lg px-3 py-2"
                    value={seatMoveBookingId}
                    onChange={(event) => setSeatMoveBookingId(event.target.value)}
                  >
                    <option value="">Select booking</option>
                    {movableBookingsForSlot.map((item) => (
                      <option key={item.bookingId} value={item.bookingId}>
                        #{item.bookingId} · {item.seatLabel} · {item.booking.guestName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Target Seat
                  <select
                    className="panel rounded-lg px-3 py-2"
                    value={seatMoveTargetSeatId}
                    onChange={(event) => setSeatMoveTargetSeatId(event.target.value)}
                  >
                    <option value="">Select available seat</option>
                    {targetSeatOptions.map((seat) => (
                      <option key={seat.seatId} value={seat.seatId}>
                        {seat.label} · {seat.segmentId || 'No segment'}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 self-end"
                  disabled={
                    !seatMoveBookingId ||
                    !seatMoveTargetSeatId ||
                    busyBookingId === Number(seatMoveBookingId)
                  }
                  onClick={() => void handleLiveSeatMove()}
                >
                  {busyBookingId === Number(seatMoveBookingId) ? 'Moving...' : 'Move Seat'}
                </button>
              </div>
              {selectedSourceBooking ? (
                <p className="text-xs text-[var(--muted)]">
                  Selected source: #{selectedSourceBooking.bookingId} from seat {selectedSourceBooking.seatLabel}.
                </p>
              ) : null}
            </article>

            <article className="panel-strong space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Visual Floor Map</h3>
                  <p className="text-xs text-[var(--muted)]">
                    Published seat geometry + live availability overlay for the selected floor/slot.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(['AVAILABLE', 'HELD', 'BOOKED', 'DISABLED'] as const).map((status) => (
                    <span key={status} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: seatStatusFill(status) }}
                      />
                      {status}
                    </span>
                  ))}
                </div>
              </div>

              {!selectedFloorLayout ? (
                <p className="text-sm text-[var(--muted)]">
                  Floor layout geometry is not available yet. The seat list below still reflects live statuses.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                    <span>{selectedFloorLayout.name}</span>
                    <span>
                      Canvas {selectedFloorLayout.plane.width} x {selectedFloorLayout.plane.height}
                    </span>
                  </div>
                  <div className="w-full p-2">
                    <svg
                      viewBox={`0 0 ${selectedFloorLayout.plane.width} ${selectedFloorLayout.plane.height}`}
                      className="h-auto w-full rounded-lg bg-[#0f172a]/5"
                      style={{ aspectRatio: `${selectedFloorLayout.plane.width} / ${selectedFloorLayout.plane.height}` }}
                    >
                      {selectedFloorLayout.background?.type === 'image' ? (
                        <image
                          href={selectedFloorLayout.background.url}
                          x={0}
                          y={0}
                          width={selectedFloorLayout.background.width}
                          height={selectedFloorLayout.background.height}
                          opacity={selectedFloorLayout.background.opacity ?? 0.35}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      ) : null}

                      {selectedFloorLayout.rooms.map((room) => (
                        <g key={room.roomId}>
                          <rect
                            x={room.shape.x}
                            y={room.shape.y}
                            width={room.shape.w}
                            height={room.shape.h}
                            fill="rgba(148,163,184,0.08)"
                            stroke="rgba(148,163,184,0.65)"
                            strokeWidth={2}
                            rx={6}
                          />
                          <text
                            x={room.shape.x + 8}
                            y={room.shape.y + 16}
                            fontSize={12}
                            fill="rgba(100,116,139,0.95)"
                          >
                            {room.name}
                          </text>
                        </g>
                      ))}

                      {visualSeatRows.map((seat) => (
                        <g key={seat.seatId}>
                          <rect
                            x={seat.geometry.x}
                            y={seat.geometry.y}
                            width={seat.geometry.w}
                            height={seat.geometry.h}
                            rx={4}
                            fill={seatStatusFill(seat.status)}
                            fillOpacity={0.8}
                            stroke={
                              seat.seatId === seatMoveTargetSeatId
                                ? '#0f766e'
                                : selectedSourceBooking?.seatId === seat.seatId
                                  ? '#b91c1c'
                                  : 'rgba(15,23,42,0.55)'
                            }
                            strokeWidth={
                              seat.seatId === seatMoveTargetSeatId ||
                              selectedSourceBooking?.seatId === seat.seatId
                                ? 2
                                : 1
                            }
                            onClick={() => {
                              if (seat.status === 'AVAILABLE') {
                                setSeatMoveTargetSeatId(seat.seatId)
                              }
                              if (seat.status === 'BOOKED' && typeof seat.bookingId === 'number') {
                                setSeatMoveBookingId(String(seat.bookingId))
                              }
                            }}
                            style={{
                              cursor:
                                seat.status === 'AVAILABLE' ||
                                (seat.status === 'BOOKED' && typeof seat.bookingId === 'number')
                                  ? 'pointer'
                                  : 'default',
                            }}
                          >
                            <title>
                              {`${seat.label} · ${seat.status}${seat.segmentId ? ` · ${seat.segmentId}` : ''}${typeof seat.bookingId === 'number' ? ` · Booking #${seat.bookingId}` : ''}`}
                            </title>
                          </rect>
                          <text
                            x={seat.geometry.x + seat.geometry.w / 2}
                            y={seat.geometry.y + seat.geometry.h / 2 + 3}
                            fontSize={Math.max(9, Math.min(12, seat.geometry.h * 0.45))}
                            textAnchor="middle"
                            fill="white"
                            pointerEvents="none"
                          >
                            {seat.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                </div>
              )}
            </article>

            {liveRows.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                {selectedSlotId
                  ? 'No seats found for selected floor.'
                  : 'Select slot and floor to load availability.'}
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {liveRows.map((seat) => (
                  <article
                    key={seat.seatId}
                    className={`panel-strong rounded-lg p-3 text-sm ${
                      seat.seatId === seatMoveTargetSeatId
                        ? 'border-teal-500/60 ring-1 ring-teal-500/40'
                        : selectedSourceBooking?.seatId === seat.seatId
                          ? 'border-rose-500/60 ring-1 ring-rose-500/40'
                          : ''
                    }`}
                  >
                    <p className="font-medium">{seat.label}</p>
                    <p className={seatStatusClass(seat.status)}>
                      {seat.status}
                    </p>
                    {seat.segmentId ? (
                      <p className="text-xs text-[var(--muted)]">Segment: {seat.segmentId}</p>
                    ) : null}
                    {seat.holdExpiresAt ? (
                      <p className="text-xs text-[var(--muted)]">
                        Hold until {new Date(seat.holdExpiresAt).toLocaleTimeString()}
                      </p>
                    ) : null}
                    {typeof seat.bookingId === 'number' ? (
                      <p className="text-xs text-[var(--muted)]">Booking #{seat.bookingId}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {seat.status === 'AVAILABLE' ? (
                        <button
                          type="button"
                          className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                          onClick={() => setSeatMoveTargetSeatId(seat.seatId)}
                        >
                          Set as target
                        </button>
                      ) : null}
                      {seat.status === 'BOOKED' && typeof seat.bookingId === 'number' ? (
                        <button
                          type="button"
                          className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                          onClick={() => setSeatMoveBookingId(String(seat.bookingId))}
                        >
                          Set as source
                        </button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  if (section === 'customers') {
    return <HostCustomersSection activeClubId={activeClubId!} />
  }

  if (section === 'payments') {
    return <FinanceInvoicesSection activeClubId={activeClubId!} />
  }

  if (section === 'support') {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Support</h2>
        <article className="panel-strong p-4 text-sm">
          <p className="font-medium">Operations Support</p>
          <p className="mt-1 text-[var(--muted)]">
            For booking conflicts, payment corrections, and emergency pauses contact tech admin.
          </p>
          <p className="mt-2 text-[var(--muted)]">Email: support@booking.app</p>
        </article>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Today Operations</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <article className="panel-strong p-3">
          <p className="text-xs text-[var(--muted)]">Bookings today</p>
          <p className="text-xl font-semibold">{metrics.total}</p>
        </article>
        <article className="panel-strong p-3">
          <p className="text-xs text-[var(--muted)]">Checked-in</p>
          <p className="text-xl font-semibold">{metrics.checkedIn}</p>
        </article>
        <article className="panel-strong p-3">
          <p className="text-xs text-[var(--muted)]">Pending payments</p>
          <p className="text-xl font-semibold">{metrics.pendingPayments}</p>
        </article>
        <article className="panel-strong p-3">
          <p className="text-xs text-[var(--muted)]">Active occupancy</p>
          <p className="text-xl font-semibold">{metrics.active}</p>
        </article>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href="/bookings"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
        >
          Create booking
        </Link>
        <Link
          href="/cabinet/host/bookings"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
        >
          Search booking
        </Link>
        <Link
          href="/cabinet/host/live-map"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
        >
          Open live map
        </Link>
      </div>

      <article className="panel-strong space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Recent Club Bookings</h3>
          <Link
            href="/cabinet/host/bookings"
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
          >
            Open full bookings
          </Link>
        </div>
        {bookings.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No bookings found for this club yet.</p>
        ) : (
          <div className="space-y-2">
            {bookings.slice(0, 8).map((booking) => (
              <article key={booking.id} className="panel rounded-lg p-3 text-sm">
                <p className="font-medium">
                  #{booking.id} · {booking.room.name} · {booking.guestName}
                </p>
                <p className="text-xs text-[var(--muted)]">{formatDateRange(booking.checkIn, booking.checkOut)}</p>
                <p className="text-xs text-[var(--muted)]">
                  {booking.status} · payment {booking.paymentStatus}
                </p>
              </article>
            ))}
          </div>
        )}
      </article>
    </div>
  )
}
