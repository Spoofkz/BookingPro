'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'

type BookingDetail = {
  id: number
  clubId: string | null
  slotId: string | null
  seatId: string | null
  seatLabelSnapshot: string | null
  status: string
  paymentStatus: string
  guestName: string
  guestEmail: string
  guestPhone: string | null
  checkIn: string
  checkOut: string
  notes: string | null
  rescheduleCount: number
  priceTotalCents: number | null
  priceCurrency: string | null
  priceSnapshotJson: string | null
  club?: {
    id: string
    name: string
    slug: string
    address: string | null
    city: string | null
    area: string | null
    timezone: string
    currency: string
  } | null
  room: {
    id: number
    name: string
    slug: string
  }
  slot: {
    id: string
    startAtUtc: string
    endAtUtc: string
    status: string
  } | null
  payments: Array<{
    id: number
    amountCents: number
    method: string
    status: string
    createdAt: string
  }>
  policies?: {
    cancellation?: {
      cutoffMinutes: number
      deadline: string | null
      allowedNow: boolean
    }
    reschedule?: {
      enabled: boolean
      cutoffMinutesBeforeStart: number
      deadline: string | null
      maxReschedulesPerBooking: number
      currentRescheduleCount: number
      allowAfterStart: boolean
      allowedNow: boolean
    }
  }
  timeline?: Array<{
    id: string
    type: string
    at: string
    actorUserId: string | null
    description: string
  }>
}

type SlotItem = {
  slotId: string
  startAt: string
  endAt: string
  status: 'PUBLISHED' | 'BLOCKED' | 'CANCELLED_LOCKED'
}

type RescheduleIntentResponse = {
  rescheduleId: string
  expiresAt: string
  oldTotal: number
  newTotal: number
  delta: number
  requiredAction: string
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString()
}

function formatRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatMoney(cents: number | null, currency: string | null) {
  if (cents == null) return 'N/A'
  const finalCurrency = currency || 'KZT'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: finalCurrency,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${finalCurrency}`
  }
}

function todayDateInput() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function ClientBookingDetailsPage({ bookingId }: { bookingId: number }) {
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<BookingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [cancelBusy, setCancelBusy] = useState(false)
  const [rescheduleBusy, setRescheduleBusy] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState(todayDateInput())
  const [slots, setSlots] = useState<SlotItem[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState('')
  const [intent, setIntent] = useState<RescheduleIntentResponse | null>(null)

  const qrLikeCode = useMemo(() => {
    const stamp = String(new Date(detail?.checkIn || Date.now()).getTime())
    return `BK-${bookingId}-${stamp.slice(-6)}`
  }, [bookingId, detail?.checkIn])

  async function loadDetail() {
    const response = await fetch(`/api/client/bookings/${bookingId}`, { cache: 'no-store' })
    const payload = (await response.json()) as BookingDetail | { error?: string }
    if (!response.ok) {
      throw new Error((payload as { error?: string }).error || 'Failed to load booking.')
    }
    setDetail(payload as BookingDetail)
  }

  async function loadSlotsForDate(clubId: string, date: string) {
    const response = await fetch(`/api/clubs/${clubId}/slots?date=${encodeURIComponent(date)}`, {
      cache: 'no-store',
    })
    const payload = (await response.json()) as { items?: SlotItem[]; error?: string }
    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load slots.')
    }
    const items = payload.items || []
    setSlots(items)
    setSelectedSlotId((current) => {
      if (current && items.some((item) => item.slotId === current)) return current
      return items.find((item) => item.status === 'PUBLISHED')?.slotId || ''
    })
  }

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        await loadDetail()
      } catch (loadError) {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load booking details.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [bookingId])

  useEffect(() => {
    if (!detail?.club?.id) return
    void loadSlotsForDate(detail.club.id, rescheduleDate).catch((loadError) =>
      setError(loadError instanceof Error ? loadError.message : 'Failed to load slots.'),
    )
  }, [detail?.club?.id, rescheduleDate])

  async function handleCancel() {
    if (!detail) return
    setCancelBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/client/bookings/${detail.id}/cancel`, {
        method: 'POST',
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to cancel booking.')
      }
      setMessage('Booking canceled successfully.')
      await loadDetail()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel booking.')
    } finally {
      setCancelBusy(false)
    }
  }

  async function handleCreateRescheduleIntent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || !selectedSlotId) return
    setRescheduleBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/client/bookings/${detail.id}/reschedule/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newSlotId: selectedSlotId,
          newSeatId: detail.seatId || undefined,
        }),
      })
      const payload = (await response.json()) as
        | RescheduleIntentResponse
        | { error?: string; code?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to create reschedule intent.')
      }
      setIntent(payload as RescheduleIntentResponse)
      setMessage('Reschedule intent created. Review delta and confirm.')
    } catch (intentError) {
      setError(intentError instanceof Error ? intentError.message : 'Failed to create reschedule intent.')
    } finally {
      setRescheduleBusy(false)
    }
  }

  async function handleConfirmReschedule() {
    if (!detail || !intent) return
    setRescheduleBusy(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/client/bookings/${detail.id}/reschedule/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rescheduleId: intent.rescheduleId,
          payMode: 'OFFLINE',
        }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to confirm reschedule.')
      }
      setIntent(null)
      setMessage('Booking rescheduled successfully.')
      await loadDetail()
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to confirm reschedule.')
    } finally {
      setRescheduleBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading booking details...</p>
  }

  if (error && !detail) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Booking details</h2>
        <article className="panel-strong rounded-lg border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Booking not found</h2>
        <p className="text-sm text-[var(--muted)]">This booking is unavailable for your account.</p>
      </div>
    )
  }

  const canCancel = detail.policies?.cancellation?.allowedNow !== false && detail.status === 'CONFIRMED'
  const canReschedule =
    detail.policies?.reschedule?.allowedNow !== false &&
    (detail.status === 'CONFIRMED' || detail.status === 'CHECKED_IN')

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Booking 360</p>
        <h2 className="text-2xl font-semibold">Booking #{detail.id}</h2>
        <p className="text-sm text-[var(--muted)]">
          {detail.club?.name || 'Unknown club'} · {detail.status} · Payment {detail.paymentStatus}
        </p>
      </header>

      {message ? (
        <article className="panel-strong rounded-lg border-emerald-400/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </article>
      ) : null}
      {error ? (
        <article className="panel-strong rounded-lg border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Summary</h3>
          <p className="text-sm">
            {detail.club?.city ? `${detail.club.city} · ` : ''}
            {detail.club?.address || 'Address not specified'}
          </p>
          <p className="text-sm">{formatRange(detail.checkIn, detail.checkOut)}</p>
          <p className="text-sm">
            Seat: {detail.seatLabelSnapshot || detail.seatId || 'N/A'} · Room: {detail.room.name}
          </p>
          <p className="text-sm">Guest: {detail.guestName}</p>
          <p className="text-sm">Contact: {detail.guestEmail}{detail.guestPhone ? ` · ${detail.guestPhone}` : ''}</p>
          {detail.notes ? <p className="text-sm text-[var(--muted)]">Notes: {detail.notes}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={!canCancel || cancelBusy}
              onClick={() => void handleCancel()}
            >
              {cancelBusy ? 'Cancelling...' : 'Cancel booking'}
            </button>
            <Link
              href="/bookings"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            >
              Book again
            </Link>
            <Link
              href="/me/support"
              className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
            >
              Contact support
            </Link>
          </div>
        </article>

        <aside className="space-y-3">
          <article className="panel-strong p-4 text-sm">
            <h3 className="text-base font-semibold">QR / Check-in</h3>
            <p className="mt-2 text-xs text-[var(--muted)]">Show this code to host</p>
            <p className="mt-1 font-mono text-lg">{qrLikeCode}</p>
          </article>

          <article className="panel-strong p-4 text-sm">
            <h3 className="text-base font-semibold">Price snapshot</h3>
            <p className="mt-2">{formatMoney(detail.priceTotalCents, detail.priceCurrency || detail.club?.currency || 'KZT')}</p>
          </article>

          <article className="panel-strong p-4 text-sm">
            <h3 className="text-base font-semibold">Policy</h3>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Cancellation cutoff: {detail.policies?.cancellation?.cutoffMinutes ?? 0} min
            </p>
            <p className="text-xs text-[var(--muted)]">
              Cancel allowed now: {detail.policies?.cancellation?.allowedNow ? 'Yes' : 'No'}
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Reschedule count: {detail.policies?.reschedule?.currentRescheduleCount ?? detail.rescheduleCount}/
              {detail.policies?.reschedule?.maxReschedulesPerBooking ?? 0}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Reschedule allowed now: {detail.policies?.reschedule?.allowedNow ? 'Yes' : 'No'}
            </p>
          </article>
        </aside>
      </section>

      <section className="panel-strong space-y-3 p-4">
        <h3 className="text-lg font-semibold">Payments</h3>
        {detail.payments.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No payment records yet. Pay at venue if required.</p>
        ) : (
          <div className="space-y-2">
            {detail.payments.map((payment) => (
              <article key={payment.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                <p className="font-medium">
                  {formatMoney(payment.amountCents, detail.priceCurrency || detail.club?.currency || 'KZT')} · {payment.method}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {payment.status} · {formatDateTime(payment.createdAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel-strong space-y-3 p-4">
        <h3 className="text-lg font-semibold">Reschedule</h3>
        {!canReschedule ? (
          <p className="text-sm text-[var(--muted)]">Reschedule is not available for this booking right now.</p>
        ) : (
          <form className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]" onSubmit={(event) => void handleCreateRescheduleIntent(event)}>
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                type="date"
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                value={rescheduleDate}
                onChange={(event) => setRescheduleDate(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Slot
              <select
                className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
                value={selectedSlotId}
                onChange={(event) => setSelectedSlotId(event.target.value)}
              >
                {slots.length === 0 ? <option value="">No slots</option> : null}
                {slots.map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {formatRange(slot.startAt, slot.endAt)} ({slot.status})
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                disabled={rescheduleBusy || !selectedSlotId}
              >
                {rescheduleBusy ? 'Creating...' : 'Create intent'}
              </button>
            </div>
          </form>
        )}

        {intent ? (
          <article className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <p className="font-medium">Intent {intent.rescheduleId}</p>
            <p className="text-xs text-[var(--muted)]">
              Old total: {intent.oldTotal} · New total: {intent.newTotal} · Delta: {intent.delta}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Required action: {intent.requiredAction} · Expires at {formatDateTime(intent.expiresAt)}
            </p>
            <button
              type="button"
              className="mt-2 rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
              disabled={rescheduleBusy}
              onClick={() => void handleConfirmReschedule()}
            >
              {rescheduleBusy ? 'Confirming...' : 'Confirm reschedule'}
            </button>
          </article>
        ) : null}
      </section>

      <section className="panel-strong space-y-3 p-4">
        <h3 className="text-lg font-semibold">Timeline</h3>
        {detail.timeline?.length ? (
          <div className="space-y-2">
            {detail.timeline.map((item) => (
              <article key={item.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.15em] text-[var(--muted)]">{item.type}</p>
                <p className="font-medium">{item.description}</p>
                <p className="text-xs text-[var(--muted)]">
                  {formatDateTime(item.at)}
                  {item.actorUserId ? ` · actor ${item.actorUserId}` : ''}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">No timeline events.</p>
        )}
      </section>
    </div>
  )
}

