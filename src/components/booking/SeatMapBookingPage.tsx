'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  activeClubId: string | null
  activeRole: string
  profile?: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
}

type ClientMeResponse = {
  userId: string
  activeClubId: string | null
  profile: {
    name: string
    phone: string | null
    email: string | null
  }
}

type PublicClubItem = {
  clubId: string
  name: string
  city: string | null
  area: string | null
  openNow: boolean
  nextSlotAt: string | null
}

type PublicSegmentItem = {
  id: string
  name: string
}

type SlotItem = {
  slotId: string
  startAt: string
  endAt: string
  status: 'PUBLISHED' | 'BLOCKED' | 'CANCELLED_LOCKED'
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
  } | null
  rooms: Array<{
    roomId: string
    name: string
    shape: RectGeometry
  }>
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
}

type HoldResponse = {
  holdId: string
  clubId: string
  slotId: string
  seatId: string
  status: string
  expiresAt: string
}

type QuotePreviewResponse = {
  quoteId: string
  currency: string
  total: number
  breakdown: Array<{
    type: string
    label: string
    amount: number
  }>
}

type ConfirmHoldResponse = {
  bookingId: number
  status: string
  paymentStatus: string
  slotId: string
  seatId: string
  checkIn: string
  checkOut: string
  totalDue?: number
}

type BookingGuestForm = {
  guestName: string
  guestEmail: string
  guestPhone: string
  guests: string
  notes: string
}

type VisualSeatRow = {
  seatId: string
  label: string
  segmentId: string
  segmentName: string
  roomId: string | null
  geometry: RectGeometry
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'DISABLED'
  holdExpiresAt?: string
  isDisabled: boolean
}

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

function seatStatusFill(status: VisualSeatRow['status']) {
  if (status === 'AVAILABLE') return '#10b981'
  if (status === 'HELD') return '#f59e0b'
  if (status === 'BOOKED') return '#ef4444'
  return '#64748b'
}

function seatStatusTextClass(status: VisualSeatRow['status']) {
  if (status === 'AVAILABLE') return 'text-emerald-700 dark:text-emerald-300'
  if (status === 'HELD') return 'text-amber-700 dark:text-amber-300'
  if (status === 'BOOKED') return 'text-rose-700 dark:text-rose-300'
  return 'text-slate-700 dark:text-slate-300'
}

function formatSlotLabel(slot: SlotItem) {
  return `${new Date(slot.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(slot.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatMoney(amountKzt: number, _currency = 'KZT') {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

function formatCountdown(expiresAtIso: string, nowMs: number) {
  const msLeft = new Date(expiresAtIso).getTime() - nowMs
  if (msLeft <= 0) return '00:00'
  const total = Math.floor(msLeft / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function SeatMapBookingPage() {
  const router = useRouter()
  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [publicClubs, setPublicClubs] = useState<PublicClubItem[]>([])
  const [segmentNameById, setSegmentNameById] = useState<Record<string, string>>({})
  const [selectedPublicClubId, setSelectedPublicClubId] = useState<string | null>(null)
  const [activeRole, setActiveRole] = useState<string>('CLIENT')
  const [guestForm, setGuestForm] = useState<BookingGuestForm>({
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    guests: '1',
    notes: '',
  })
  const [slotDate, setSlotDate] = useState(todayDateInput())
  const [slots, setSlots] = useState<SlotItem[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState('')
  const [floors, setFloors] = useState<FloorLayout[]>([])
  const [publishedSeats, setPublishedSeats] = useState<PublishedSeat[]>([])
  const [selectedFloorId, setSelectedFloorId] = useState('')
  const [availabilitySeats, setAvailabilitySeats] = useState<AvailabilitySeat[]>([])
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null)
  const [hold, setHold] = useState<HoldResponse | null>(null)
  const [quotePreview, setQuotePreview] = useState<QuotePreviewResponse | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [confirmResult, setConfirmResult] = useState<ConfirmHoldResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)
  const [holdBusy, setHoldBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [isClientAuthenticated, setIsClientAuthenticated] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authPhone, setAuthPhone] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [authSending, setAuthSending] = useState(false)
  const [authVerifying, setAuthVerifying] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [authDevCode, setAuthDevCode] = useState<string | null>(null)
  const [authIntent, setAuthIntent] = useState<'LOGIN' | 'REGISTER'>('LOGIN')
  const [pendingSeatIdAfterAuth, setPendingSeatIdAfterAuth] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const effectiveClubId = activeClubId || selectedPublicClubId

  async function loadPublicClubs() {
    const response = await fetch('/api/clubs/public?limit=50', { cache: 'no-store' })
    const payload = await readJson<{ items: PublicClubItem[] }>(
      response,
      'Failed to load public clubs.',
    )
    const items = payload.items || []
    setPublicClubs(items)
    setSelectedPublicClubId((current) => {
      if (activeClubId) return null
      if (current && items.some((club) => club.clubId === current)) return current
      return items[0]?.clubId || null
    })
    return items
  }

  async function loadPublicSegments(clubId: string) {
    const response = await fetch(`/api/clubs/public/${clubId}/segments`, { cache: 'no-store' })
    if (!response.ok) {
      setSegmentNameById({})
      return
    }
    const payload = await readJson<{ items: PublicSegmentItem[] }>(
      response,
      'Failed to load segments.',
    )
    const map: Record<string, string> = {}
    for (const item of payload.items || []) {
      map[item.id] = item.name
    }
    setSegmentNameById(map)
  }

  async function loadMe() {
    const response = await fetch('/api/me', { cache: 'no-store' })
    const me = await readJson<MeResponse>(response, 'Failed to load session context.')
    setActiveClubId(me.activeClubId)
    setActiveRole(me.activeRole || 'CLIENT')
    setGuestForm((current) => ({
      ...current,
      guestName: current.guestName || (me.profile?.name || ''),
      guestEmail: current.guestEmail || (me.profile?.email || ''),
      guestPhone: current.guestPhone || (me.profile?.phone || ''),
    }))
    return me.activeClubId
  }

  async function loadClientAuthStatus() {
    const response = await fetch('/api/client/me', { cache: 'no-store' })
    if (!response.ok) {
      setIsClientAuthenticated(false)
      return false
    }

    const client = (await response.json()) as ClientMeResponse
    setIsClientAuthenticated(true)
    setAuthPhone((current) => current || client.profile.phone || '')
    setGuestForm((current) => ({
      ...current,
      guestName: current.guestName || client.profile.name || '',
      guestEmail: current.guestEmail || client.profile.email || '',
      guestPhone: current.guestPhone || client.profile.phone || '',
    }))
    return true
  }

  async function ensureClientAuthForBookingAction() {
    if (isClientAuthenticated) return true
    const authenticated = await loadClientAuthStatus()
    if (authenticated) return true
    setAuthIntent('LOGIN')
    setAuthModalOpen(true)
    setAuthError(null)
    setAuthMessage('Login to book this seat.')
    return false
  }

  function applyMapDataset(nextFloors: FloorLayout[], seats: PublishedSeat[]) {
    setFloors(nextFloors)
    setPublishedSeats(seats)
    const floorIds = Array.from(new Set(seats.map((seat) => seat.floorId))).sort((a, b) =>
      a.localeCompare(b),
    )
    setSelectedFloorId((current) => (current && floorIds.includes(current) ? current : floorIds[0] || ''))
  }

  async function loadPublishedMapFromPublicEndpoint(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/map?version=latest`, {
      cache: 'no-store',
    })
    const payload = await readJson<{
      map: {
        floors?: Array<{
          floorId: string
          name: string
          plane: { width: number; height: number }
          background?: FloorLayout['background']
          rooms?: Array<{ roomId: string; name: string; shape: unknown }>
          elements?: Array<{
            type: string
            seatId?: string
            label?: string
            segmentId?: string
            roomId?: string
            isDisabled?: boolean
            shape?: unknown
          }>
        }>
      }
    }>(response, 'Failed to load published map.')

    const nextFloors: FloorLayout[] = []
    const seats: PublishedSeat[] = []
    for (const floor of payload.map?.floors || []) {
      if (!floor.floorId || !floor.plane?.width || !floor.plane?.height) continue
      const rooms = (floor.rooms || []).reduce<FloorLayout['rooms']>((acc, room) => {
        const shape = asRectGeometry(room.shape)
        if (!shape) return acc
        acc.push({
          roomId: room.roomId,
          name: room.name || room.roomId,
          shape,
        })
        return acc
      }, [])

      nextFloors.push({
        floorId: floor.floorId,
        name: floor.name || floor.floorId,
        plane: floor.plane,
        background: floor.background ?? null,
        rooms,
      })

      for (const element of floor.elements || []) {
        if (element.type !== 'seat' || !element.seatId) continue
        const geometry = asRectGeometry(element.shape)
        if (!geometry) continue
        seats.push({
          seatId: element.seatId,
          floorId: floor.floorId,
          roomId: element.roomId || null,
          segmentId: element.segmentId || 'UNASSIGNED',
          label: element.label || element.seatId,
          isDisabled: Boolean(element.isDisabled),
          geometry,
        })
      }
    }

    applyMapDataset(nextFloors, seats)
  }

  async function loadPublishedMapSeats(clubId: string) {
    const response = await fetch(`/api/clubs/${clubId}/seats?mapVersion=latest`, {
      cache: 'no-store',
      headers: { 'X-Club-Id': clubId },
    })
    if (!response.ok) {
      await loadPublishedMapFromPublicEndpoint(clubId)
      return
    }

    const payload = (await response.json()) as {
      floors?: Array<{
        floorId: string
        name: string
        plane: { width: number; height: number }
        background?: FloorLayout['background']
        rooms?: Array<{ roomId: string; name: string; shape: unknown }>
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
    }

    const nextFloors = (payload.floors || []).reduce<FloorLayout[]>((acc, floor) => {
      if (!floor.floorId || !floor.plane?.width || !floor.plane?.height) return acc
      const rooms = (floor.rooms || []).reduce<FloorLayout['rooms']>((roomsAcc, room) => {
        const shape = asRectGeometry(room.shape)
        if (!shape) return roomsAcc
        roomsAcc.push({
          roomId: room.roomId,
          name: room.name || room.roomId,
          shape,
        })
        return roomsAcc
      }, [])
      acc.push({
        floorId: floor.floorId,
        name: floor.name || floor.floorId,
        plane: floor.plane,
        background: floor.background ?? null,
        rooms,
      })
      return acc
    }, [])

    const seats = (payload.seats || []).map((seat) => ({
      ...seat,
      geometry: asRectGeometry(seat.geometry),
    }))

    applyMapDataset(nextFloors, seats)
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
      return items.find((slot) => slot.status === 'PUBLISHED')?.slotId || items[0]?.slotId || ''
    })
  }

  async function loadAvailability(clubId: string, slotId: string, floorId: string) {
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

  async function cancelActiveHold() {
    const clubId = effectiveClubId
    if (!clubId || !hold) return
    const response = await fetch(`/api/clubs/${clubId}/holds/${hold.holdId}/cancel`, {
      method: 'POST',
      headers: { 'X-Club-Id': clubId },
    })
    if (response.status === 401) {
      setIsClientAuthenticated(false)
      setAuthModalOpen(true)
      throw new Error('Login required to manage this hold.')
    }
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string }
      throw new Error(payload.error || 'Failed to cancel hold.')
    }
    setHold(null)
  }

  async function createHoldForSeatInternal(
    seatId: string,
    options?: { afterAuth?: boolean },
  ) {
    const clubId = effectiveClubId
    if (!clubId || !selectedSlotId) return
    setHoldBusy(true)
    setError(null)
    setMessage(null)
    setConfirmResult(null)
    try {
      if (hold && (hold.seatId !== seatId || hold.slotId !== selectedSlotId)) {
        await cancelActiveHold()
      }

      const response = await fetch(`/api/clubs/${clubId}/holds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Club-Id': clubId,
        },
        body: JSON.stringify({
          slotId: selectedSlotId,
          seatId,
        }),
      })

      const payload = (await response.json()) as HoldResponse | { error?: string }
      if (response.status === 401) {
        setIsClientAuthenticated(false)
        setAuthModalOpen(true)
        throw new Error('Login required to book this seat.')
      }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to create hold.')
      }
      setHold(payload as HoldResponse)
      setSelectedSeatId(seatId)
      setMessage('Seat hold created. Complete booking before the timer expires.')
      await loadAvailability(clubId, selectedSlotId, selectedFloorId)
    } catch (createError) {
      const resolvedError =
        createError instanceof Error ? createError.message : 'Failed to create hold.'
      if (
        options?.afterAuth &&
        /already booked|held by another user|seat is held|seat is already/i.test(resolvedError)
      ) {
        setMessage('This seat was taken while you logged in—choose another.')
      } else {
        setError(resolvedError)
      }
    } finally {
      setHoldBusy(false)
    }
  }

  async function handleHoldSeat(seatId: string) {
    const authenticated = await ensureClientAuthForBookingAction()
    if (!authenticated) {
      setPendingSeatIdAfterAuth(seatId)
      return
    }
    await createHoldForSeatInternal(seatId)
  }

  async function handleConfirmHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clubId = effectiveClubId
    if (!clubId || !hold) return
    const authenticated = await ensureClientAuthForBookingAction()
    if (!authenticated) return
    setConfirmBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/clubs/${clubId}/holds/${hold.holdId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Club-Id': clubId,
        },
        body: JSON.stringify({
          guestName: guestForm.guestName || undefined,
          guestEmail: guestForm.guestEmail || undefined,
          guestPhone: guestForm.guestPhone || undefined,
          guests: Number(guestForm.guests || 1),
          notes: guestForm.notes || undefined,
          paymentMode: 'OFFLINE',
        }),
      })
      const payload = (await response.json()) as ConfirmHoldResponse | { error?: string }
      if (response.status === 401) {
        setIsClientAuthenticated(false)
        setAuthModalOpen(true)
        throw new Error('Login required to confirm booking.')
      }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to confirm booking.')
      }
      setConfirmResult(payload as ConfirmHoldResponse)
      setHold(null)
      setMessage('Booking confirmed from seat hold.')
      await loadAvailability(clubId, selectedSlotId, selectedFloorId)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to confirm booking.')
    } finally {
      setConfirmBusy(false)
    }
  }

  async function handleSendOtp() {
    const phone = authPhone.trim() || guestForm.guestPhone.trim()
    if (!phone) {
      setAuthError('Phone is required to send OTP.')
      return
    }

    setAuthSending(true)
    setAuthError(null)
    setAuthMessage(null)
    setAuthDevCode(null)
    try {
      const response = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const payload = (await response.json()) as { error?: string; devCode?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send OTP.')
      }
      setAuthPhone(phone)
      setAuthDevCode(payload.devCode || null)
      setAuthMessage('OTP sent. Enter the code to continue booking.')
    } catch (sendError) {
      setAuthError(sendError instanceof Error ? sendError.message : 'Failed to send OTP.')
    } finally {
      setAuthSending(false)
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const phone = authPhone.trim() || guestForm.guestPhone.trim()
    const code = authCode.trim()
    if (!phone || !code) {
      setAuthError('Phone and OTP code are required.')
      return
    }

    setAuthVerifying(true)
    setAuthError(null)
    try {
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to verify OTP.')
      }

      setIsClientAuthenticated(true)
      setAuthModalOpen(false)
      setAuthCode('')
      setAuthMessage(null)
      setAuthError(null)
      setAuthDevCode(null)
      setAuthIntent('LOGIN')

      await loadClientAuthStatus()
      await loadMe()
      setPendingSeatIdAfterAuth(null)
      router.push('/me/profile')
    } catch (verifyError) {
      setAuthError(verifyError instanceof Error ? verifyError.message : 'Failed to verify OTP.')
    } finally {
      setAuthVerifying(false)
    }
  }

  useEffect(() => {
    let mounted = true
    async function init() {
      try {
        setLoading(true)
        setError(null)
        const clubId = await loadMe()
        await loadClientAuthStatus()
        if (!clubId) {
          await loadPublicClubs()
        }
      } catch (loadError) {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load booking flow.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void init()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!effectiveClubId) return
    const clubId = effectiveClubId
    let cancelled = false
    async function loadMap() {
      try {
        setError(null)
        await loadPublishedMapSeats(clubId)
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load published map.')
      }
    }
    void loadMap()
    return () => {
      cancelled = true
    }
  }, [effectiveClubId])

  useEffect(() => {
    if (!effectiveClubId) {
      setSegmentNameById({})
      return
    }
    let cancelled = false
    void loadPublicSegments(effectiveClubId).catch(() => {
      if (!cancelled) {
        setSegmentNameById({})
      }
    })
    return () => {
      cancelled = true
    }
  }, [effectiveClubId])

  useEffect(() => {
    if (!effectiveClubId) return
    const clubId = effectiveClubId
    let cancelled = false
    void loadSlotsForDate(clubId, slotDate).catch((loadError) => {
      if (cancelled) return
      setError(loadError instanceof Error ? loadError.message : 'Failed to load slots.')
    })
    return () => {
      cancelled = true
    }
  }, [effectiveClubId, slotDate])

  useEffect(() => {
    if (!effectiveClubId || !selectedSlotId || !selectedFloorId) {
      setAvailabilitySeats([])
      return
    }
    const clubId = effectiveClubId
    let cancelled = false
    async function refresh() {
      try {
        await loadAvailability(clubId, selectedSlotId, selectedFloorId)
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load availability.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [effectiveClubId, selectedSlotId, selectedFloorId])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!hold) return
    if (new Date(hold.expiresAt).getTime() <= nowMs) {
      setHold(null)
      setMessage('Hold expired. Select the seat again to continue.')
    }
  }, [hold, nowMs])

  useEffect(() => {
    if (!effectiveClubId || !selectedSlotId || !selectedSeatId) {
      setQuotePreview(null)
      setQuoteError(null)
      return
    }

    let cancelled = false
    async function loadQuote() {
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const response = await fetch('/api/pricing/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clubId: effectiveClubId,
            slotId: selectedSlotId,
            seatId: selectedSeatId,
            channel: 'ONLINE',
          }),
        })
        const payload = (await response.json()) as
          | QuotePreviewResponse
          | {
              error?: string
              code?: string
            }
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Login to view exact price quote.')
          }
          const message =
            payload && typeof payload === 'object' && 'error' in payload
              ? (payload.error as string | undefined)
              : undefined
          throw new Error(message || 'Failed to load quote preview.')
        }
        if (!cancelled) {
          setQuotePreview(payload as QuotePreviewResponse)
        }
      } catch (quoteLoadError) {
        if (!cancelled) {
          setQuotePreview(null)
          setQuoteError(
            quoteLoadError instanceof Error ? quoteLoadError.message : 'Failed to load quote preview.',
          )
        }
      } finally {
        if (!cancelled) {
          setQuoteLoading(false)
        }
      }
    }

    void loadQuote()
    return () => {
      cancelled = true
    }
  }, [effectiveClubId, selectedSeatId, selectedSlotId])

  const floorOptions = useMemo(
    () => Array.from(new Set(publishedSeats.map((seat) => seat.floorId))).sort((a, b) => a.localeCompare(b)),
    [publishedSeats],
  )

  const selectedFloorLayout = useMemo(
    () => floors.find((floor) => floor.floorId === selectedFloorId) ?? null,
    [floors, selectedFloorId],
  )

  const floorSeatsById = useMemo(() => {
    const rows = publishedSeats.filter((seat) => seat.floorId === selectedFloorId)
    return new Map(rows.map((seat) => [seat.seatId, seat]))
  }, [publishedSeats, selectedFloorId])

  const availabilityBySeatId = useMemo(
    () => new Map(availabilitySeats.map((seat) => [seat.seatId, seat])),
    [availabilitySeats],
  )

  const visualSeats = useMemo<VisualSeatRow[]>(() => {
    const rows: VisualSeatRow[] = []
    for (const seat of publishedSeats) {
      if (seat.floorId !== selectedFloorId || !seat.geometry) continue
      const overlay = availabilityBySeatId.get(seat.seatId)
      const segmentName = segmentNameById[seat.segmentId] || seat.segmentId
      rows.push({
        seatId: seat.seatId,
        label: seat.label,
        segmentId: seat.segmentId,
        segmentName,
        roomId: seat.roomId,
        geometry: seat.geometry,
        status: overlay?.status ?? (seat.isDisabled ? 'DISABLED' : 'AVAILABLE'),
        holdExpiresAt: overlay?.holdExpiresAt,
        isDisabled: seat.isDisabled,
      })
    }
    rows.sort((a, b) => a.label.localeCompare(b.label))
    return rows
  }, [availabilityBySeatId, publishedSeats, segmentNameById, selectedFloorId])

  const selectedSeat = useMemo(
    () => visualSeats.find((seat) => seat.seatId === selectedSeatId) ?? null,
    [selectedSeatId, visualSeats],
  )
  const holdSeat = useMemo(
    () => (hold ? visualSeats.find((seat) => seat.seatId === hold.seatId) ?? null : null),
    [hold, visualSeats],
  )

  const counts = useMemo(() => {
    const summary = { AVAILABLE: 0, HELD: 0, BOOKED: 0, DISABLED: 0 }
    for (const seat of visualSeats) summary[seat.status] += 1
    return summary
  }, [visualSeats])

  const holdCountdown = hold ? formatCountdown(hold.expiresAt, nowMs) : null

  if (loading) {
    return <p className="p-6 text-sm text-[var(--muted)]">Loading seat-map booking...</p>
  }

  return (
    <main className="min-h-screen w-full p-4 md:p-8">
      <section className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <header className="panel p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Booking Project</p>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Seat Map Booking (vNext)</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Select a slot, choose a seat on the map, create a hold, then confirm the booking.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-[var(--border)] px-2 py-1">Role: {activeRole}</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">
              Booking club: {effectiveClubId || 'select public club'}
            </span>
            <span className="rounded-full border border-[var(--border)] px-2 py-1">
              Client auth: {isClientAuthenticated ? 'signed in' : 'required for booking'}
            </span>
            {!activeClubId && effectiveClubId ? (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                Public booking context
              </span>
            ) : null}
            <Link href="/me/bookings" className="rounded-full border border-[var(--border)] px-2 py-1 hover:bg-white/10">
              My bookings
            </Link>
            {isClientAuthenticated ? (
              <Link href="/me" className="rounded-full border border-[var(--border)] px-2 py-1 hover:bg-white/10">
                My profile
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2 py-1 hover:bg-white/10"
                  onClick={() => {
                    setAuthIntent('REGISTER')
                    setAuthModalOpen(true)
                    setAuthError(null)
                    setAuthMessage('Register with OTP or login to continue.')
                  }}
                >
                  Register
                </button>
                <button
                  type="button"
                  className="rounded-full border border-[var(--border)] px-2 py-1 hover:bg-white/10"
                  onClick={() => {
                    setAuthIntent('LOGIN')
                    setAuthModalOpen(true)
                    setAuthError(null)
                    setAuthMessage('Login to continue.')
                  }}
                >
                  Login
                </button>
              </>
            )}
          </div>
        </header>

        {!activeClubId ? (
          <article className="panel-strong space-y-3 p-4 text-sm">
            <p className="text-[var(--muted)]">
              Select a public club to continue booking.
            </p>
            {!isClientAuthenticated ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[var(--muted)]">Login to reserve a seat.</p>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                  onClick={() => {
                    setAuthIntent('REGISTER')
                    setAuthModalOpen(true)
                    setAuthError(null)
                    setAuthMessage('Register with OTP or login to continue.')
                  }}
                >
                  Register
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                  onClick={() => {
                    setAuthIntent('LOGIN')
                    setAuthModalOpen(true)
                    setAuthError(null)
                    setAuthMessage('Login to continue.')
                  }}
                >
                  Login
                </button>
              </div>
            ) : null}
            <label className="flex max-w-md flex-col gap-1 text-sm">
              Public club
              <select
                className="panel rounded-lg px-3 py-2"
                value={selectedPublicClubId || ''}
                onChange={(event) => {
                  const nextClubId = event.target.value || null
                  setSelectedPublicClubId(nextClubId)
                  setSelectedSeatId(null)
                  setConfirmResult(null)
                  setHold(null)
                  setMessage(null)
                }}
              >
                {publicClubs.length === 0 ? <option value="">No public clubs available</option> : null}
                {publicClubs.map((club) => (
                  <option key={club.clubId} value={club.clubId}>
                    {club.name}
                    {club.city ? ` · ${club.city}` : ''}
                    {club.openNow ? ' · Open now' : ''}
                  </option>
                ))}
              </select>
            </label>
          </article>
        ) : null}

        {error ? (
          <article className="panel-strong border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
            {error}
          </article>
        ) : null}
        {message ? (
          <article className="panel-strong border-emerald-400/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            {message}
          </article>
        ) : null}

        {effectiveClubId ? (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-4">
                <article className="panel-strong space-y-3 p-4">
                  <h2 className="text-lg font-semibold">1. Select Slot & Floor</h2>
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

                    <label className="flex flex-col gap-1 text-sm md:col-span-2">
                      Slot
                      <select
                        className="panel rounded-lg px-3 py-2"
                        value={selectedSlotId}
                        onChange={(event) => setSelectedSlotId(event.target.value)}
                      >
                        {slots.length === 0 ? <option value="">No slots</option> : null}
                        {slots.map((slot) => (
                          <option key={slot.slotId} value={slot.slotId}>
                            {formatSlotLabel(slot)} ({slot.status})
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
                            {floors.find((floor) => floor.floorId === floorId)?.name || floorId}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <article className="panel p-3 text-sm">
                      <p className="text-xs text-[var(--muted)]">Available</p>
                      <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">{counts.AVAILABLE}</p>
                    </article>
                    <article className="panel p-3 text-sm">
                      <p className="text-xs text-[var(--muted)]">Held</p>
                      <p className="text-xl font-semibold text-amber-700 dark:text-amber-300">{counts.HELD}</p>
                    </article>
                    <article className="panel p-3 text-sm">
                      <p className="text-xs text-[var(--muted)]">Booked</p>
                      <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">{counts.BOOKED}</p>
                    </article>
                    <article className="panel p-3 text-sm">
                      <p className="text-xs text-[var(--muted)]">Disabled</p>
                      <p className="text-xl font-semibold text-slate-700 dark:text-slate-300">{counts.DISABLED}</p>
                    </article>
                  </div>
                </article>

                <article className="panel-strong space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">2. Select Seat on Map</h2>
                    <div className="flex items-center gap-2 text-xs">
                      {(['AVAILABLE', 'HELD', 'BOOKED', 'DISABLED'] as const).map((status) => (
                        <span key={status} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seatStatusFill(status) }} />
                          {status}
                        </span>
                      ))}
                    </div>
                  </div>

                  {!selectedFloorLayout ? (
                    <p className="text-sm text-[var(--muted)]">No published floor layout found.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                        <span>{selectedFloorLayout.name}</span>
                        <span>{availabilityBusy ? 'Refreshing availability...' : 'Live availability'}</span>
                      </div>
                      <div className="w-full p-2">
                        <svg
                          viewBox={`0 0 ${selectedFloorLayout.plane.width} ${selectedFloorLayout.plane.height}`}
                          className="h-auto w-full rounded-lg bg-[#0f172a]/5"
                          style={{
                            aspectRatio: `${selectedFloorLayout.plane.width} / ${selectedFloorLayout.plane.height}`,
                          }}
                        >
                          {selectedFloorLayout.background?.type === 'image' ? (
                            <image
                              href={selectedFloorLayout.background.url}
                              x={0}
                              y={0}
                              width={selectedFloorLayout.background.width}
                              height={selectedFloorLayout.background.height}
                              opacity={selectedFloorLayout.background.opacity ?? 0.3}
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
                                rx={6}
                                fill="rgba(148,163,184,0.06)"
                                stroke="rgba(148,163,184,0.55)"
                                strokeWidth={2}
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

                          {visualSeats.map((seat) => {
                            const isSelected = selectedSeatId === seat.seatId
                            const isHeldByMe = hold?.seatId === seat.seatId && hold.slotId === selectedSlotId
                            const clickable = seat.status === 'AVAILABLE' || isHeldByMe
                            return (
                              <g key={seat.seatId}>
                                <rect
                                  x={seat.geometry.x}
                                  y={seat.geometry.y}
                                  width={seat.geometry.w}
                                  height={seat.geometry.h}
                                  rx={4}
                                  fill={seatStatusFill(seat.status)}
                                  fillOpacity={isSelected ? 0.95 : 0.78}
                                  stroke={isSelected ? '#ffffff' : 'rgba(15,23,42,0.55)'}
                                  strokeWidth={isSelected ? 2 : 1}
                                  className={clickable ? 'cursor-pointer' : 'cursor-not-allowed'}
                                  onClick={() => setSelectedSeatId(seat.seatId)}
                                >
                                  <title>
                                    {`${seat.label} · ${seat.segmentName} · ${seat.status}`}
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
                            )
                          })}
                        </svg>
                      </div>
                    </div>
                  )}

                  {visualSeats.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      No seat geometry found for selected floor.
                    </p>
                  ) : null}
                </article>
              </div>

              <div className="space-y-4">
                <article className="panel-strong space-y-3 p-4">
                  <h2 className="text-lg font-semibold">3. Hold Seat</h2>
                  {selectedSeat ? (
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">{selectedSeat.label}</p>
                      <p className="text-xs text-[var(--muted)]">Seat type: {selectedSeat.segmentName}</p>
                      <p className={seatStatusTextClass(selectedSeat.status)}>{selectedSeat.status}</p>
                      {quoteLoading ? (
                        <p className="text-xs text-[var(--muted)]">Calculating price...</p>
                      ) : quotePreview ? (
                        <div className="rounded-lg border border-[var(--border)] bg-black/10 p-2 text-xs">
                          <p>
                            Estimated total:{' '}
                            <span className="font-semibold">
                              {formatMoney(quotePreview.total, quotePreview.currency)}
                            </span>
                          </p>
                          {quotePreview.breakdown?.length ? (
                            <p className="mt-1 text-[var(--muted)]">
                              {quotePreview.breakdown
                                .map((line) =>
                                  `${line.label}: ${
                                    line.amount < 0 ? '-' : ''
                                  }${formatMoney(Math.abs(line.amount), quotePreview.currency)}`,
                                )
                                .join(' · ')}
                            </p>
                          ) : null}
                        </div>
                      ) : quoteError ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">{quoteError}</p>
                      ) : null}
                      {selectedSeat.holdExpiresAt ? (
                        <p className="text-xs text-[var(--muted)]">
                          Held until {new Date(selectedSeat.holdExpiresAt).toLocaleTimeString()}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                          disabled={
                            holdBusy ||
                            !selectedSlotId ||
                            (selectedSeat.status !== 'AVAILABLE' &&
                              !(hold?.seatId === selectedSeat.seatId && hold.slotId === selectedSlotId))
                          }
                          onClick={() => void handleHoldSeat(selectedSeat.seatId)}
                        >
                          {holdBusy ? 'Holding...' : hold?.seatId === selectedSeat.seatId ? 'Refresh Hold' : 'Hold Seat'}
                        </button>
                        {hold ? (
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                            disabled={holdBusy}
                            onClick={() => {
                              void cancelActiveHold()
                                .then(() => {
                                  setMessage('Hold cancelled.')
                                  if (effectiveClubId && selectedSlotId && selectedFloorId) {
                                    return loadAvailability(effectiveClubId, selectedSlotId, selectedFloorId)
                                  }
                                })
                                .catch((cancelError) => {
                                  setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel hold.')
                                })
                            }}
                          >
                            Cancel Hold
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--muted)]">Select a seat on the map first.</p>
                  )}

                  {!isClientAuthenticated ? (
                    <p className="text-xs text-[var(--muted)]">
                      Login to reserve a seat.
                    </p>
                  ) : null}

                  {hold ? (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-500/5 p-3 text-sm">
                      <p className="font-medium">
                        Active hold: {holdSeat?.label || hold.seatId}
                        {holdSeat ? ` · ${holdSeat.segmentName}` : ''}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        Expires in <span className="font-semibold">{holdCountdown}</span> ({new Date(hold.expiresAt).toLocaleTimeString()})
                      </p>
                      {quotePreview ? (
                        <p className="text-xs text-[var(--muted)]">
                          Estimated total: {formatMoney(quotePreview.total, quotePreview.currency)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>

                <form onSubmit={handleConfirmHold} className="panel-strong space-y-3 p-4">
                  <h2 className="text-lg font-semibold">4. Confirm Booking</h2>
                  <p className="text-xs text-[var(--muted)]">
                    Single-seat booking flow (v1). Group booking / multi-seat is a separate milestone.
                  </p>
                  <div className="rounded-lg border border-[var(--border)] bg-black/10 p-2 text-xs">
                    <p>
                      Seat: {selectedSeat?.label || holdSeat?.label || hold?.seatId || 'N/A'} · Type:{' '}
                      {selectedSeat?.segmentName || holdSeat?.segmentName || 'N/A'}
                    </p>
                    <p>
                      Estimated total:{' '}
                      {quotePreview
                        ? formatMoney(quotePreview.total, quotePreview.currency)
                        : quoteLoading
                          ? 'Calculating...'
                          : 'N/A'}
                    </p>
                  </div>

                  <label className="flex flex-col gap-1 text-sm">
                    Guest name
                    <input
                      className="panel rounded-lg px-3 py-2"
                      value={guestForm.guestName}
                      onChange={(event) =>
                        setGuestForm((current) => ({ ...current, guestName: event.target.value }))
                      }
                      placeholder="Guest name"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Guest email
                    <input
                      className="panel rounded-lg px-3 py-2"
                      type="email"
                      value={guestForm.guestEmail}
                      onChange={(event) =>
                        setGuestForm((current) => ({ ...current, guestEmail: event.target.value }))
                      }
                      placeholder="email@example.com"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Guest phone
                    <input
                      className="panel rounded-lg px-3 py-2"
                      value={guestForm.guestPhone}
                      onChange={(event) =>
                        setGuestForm((current) => ({ ...current, guestPhone: event.target.value }))
                      }
                      placeholder="+77011234567"
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Guests
                      <input
                        className="panel rounded-lg px-3 py-2"
                        type="number"
                        min={1}
                        max={8}
                        value={guestForm.guests}
                        onChange={(event) =>
                          setGuestForm((current) => ({ ...current, guests: event.target.value }))
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Payment
                      <input
                        className="panel rounded-lg px-3 py-2"
                        value="OFFLINE / pay later"
                        readOnly
                      />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    Notes (optional)
                    <textarea
                      className="panel min-h-[92px] rounded-lg px-3 py-2"
                      value={guestForm.notes}
                      onChange={(event) =>
                        setGuestForm((current) => ({ ...current, notes: event.target.value }))
                      }
                    />
                  </label>

                  <button
                    type="submit"
                    className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                    disabled={confirmBusy || !hold || !isClientAuthenticated}
                  >
                    {confirmBusy ? 'Confirming...' : 'Confirm Booking from Hold'}
                  </button>

                  {!hold ? (
                    <p className="text-xs text-[var(--muted)]">Create a seat hold first.</p>
                  ) : null}
                  {!isClientAuthenticated ? (
                    <p className="text-xs text-[var(--muted)]">Login is required to confirm the booking.</p>
                  ) : null}
                </form>

                {confirmResult ? (
                  <article className="panel-strong border-emerald-400/40 p-4 text-sm">
                    <p className="font-medium text-emerald-700 dark:text-emerald-300">
                      Booking #{confirmResult.bookingId} confirmed
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {new Date(confirmResult.checkIn).toLocaleString()} - {new Date(confirmResult.checkOut).toLocaleString()}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      Seat: {confirmResult.seatId} · Status: {confirmResult.status} · Payment: {confirmResult.paymentStatus}
                    </p>
                    {typeof confirmResult.totalDue === 'number' ? (
                      <p className="text-xs text-[var(--muted)]">Total due: {formatMoney(confirmResult.totalDue)}</p>
                    ) : null}
                  </article>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </section>

      {authModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <form
            onSubmit={(event) => void handleVerifyOtp(event)}
            className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl"
          >
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Auth Required</p>
              <h3 className="text-lg font-semibold">
                {authIntent === 'REGISTER' ? 'Register / Login' : 'Login'}
              </h3>
              <p className="text-xs text-[var(--muted)]">
                {authIntent === 'REGISTER'
                  ? 'First OTP verification creates your client account automatically.'
                  : 'Seat inventory actions require authenticated client access.'}
              </p>
            </div>

            {authError ? (
              <p className="rounded-lg border border-rose-400/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {authError}
              </p>
            ) : null}
            {authMessage ? (
              <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                {authMessage}
              </p>
            ) : null}

            <label className="flex flex-col gap-1 text-sm">
              Phone
              <input
                className="panel rounded-lg px-3 py-2"
                value={authPhone}
                onChange={(event) => setAuthPhone(event.target.value)}
                placeholder="+77011234567"
                required
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                disabled={authSending || authVerifying}
                onClick={() => void handleSendOtp()}
              >
                {authSending ? 'Sending...' : 'Send OTP'}
              </button>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              OTP code
              <input
                className="panel rounded-lg px-3 py-2"
                value={authCode}
                onChange={(event) => setAuthCode(event.target.value)}
                placeholder="6-digit code"
                required
              />
            </label>

            {authDevCode ? (
              <p className="text-xs text-[var(--muted)]">
                Dev code: <span className="font-semibold">{authDevCode}</span>
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                disabled={authVerifying}
              >
                {authVerifying ? 'Verifying...' : authIntent === 'REGISTER' ? 'Verify & Open Profile' : 'Verify & Open Profile'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
                onClick={() => {
                  setAuthModalOpen(false)
                  setPendingSeatIdAfterAuth(null)
                  setAuthError(null)
                  setAuthMessage(null)
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  )
}
