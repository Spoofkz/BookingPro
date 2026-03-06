'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Room = {
  id: number
  name: string
  slug: string
  capacity: number
  pricePerNightCents: number
}

type BookingStatus =
  | 'HELD'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'CANCELED'
  | 'COMPLETED'
  | 'NO_SHOW'

type Booking = {
  id: number
  roomId: number
  guestName: string
  guestEmail: string
  guestPhone?: string | null
  checkIn: string
  checkOut: string
  guests: number
  notes: string | null
  status: BookingStatus
  room: Room
}

type BookingFormState = {
  roomId: string
  guestName: string
  guestEmail: string
  guestPhone: string
  checkIn: string
  checkOut: string
  guests: number
  notes: string
}

type RoomFormState = {
  name: string
  capacity: number
  pricePerNight: string
}

type EditBookingFormState = BookingFormState & {
  status: BookingStatus
}

type MeSummary = {
  activeRole?: string
  activeClubId?: string | null
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatDateForInput(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isoToDateInput(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

function inputDateToIso(value: string) {
  return new Date(`${value}T00:00:00.000Z`).toISOString()
}

function formatDateRange(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
}

function bookingToEditForm(booking: Booking): EditBookingFormState {
  return {
    roomId: String(booking.roomId),
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    guestPhone: booking.guestPhone || '',
    checkIn: isoToDateInput(booking.checkIn),
    checkOut: isoToDateInput(booking.checkOut),
    guests: booking.guests,
    notes: booking.notes ?? '',
    status: booking.status,
  }
}

export default function BookingPage() {
  const searchParams = useSearchParams()
  const [rooms, setRooms] = useState<Room[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [creatingRoom, setCreatingRoom] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [cancelingId, setCancelingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditBookingFormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [prefillApplied, setPrefillApplied] = useState(false)
  const [activeRole, setActiveRole] = useState<string>('CLIENT')

  const today = useMemo(() => new Date(), [])
  const defaultCheckIn = useMemo(() => formatDateForInput(addDays(today, 1)), [today])
  const defaultCheckOut = useMemo(() => formatDateForInput(addDays(today, 2)), [today])

  const [form, setForm] = useState<BookingFormState>({
    roomId: '',
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    checkIn: defaultCheckIn,
    checkOut: defaultCheckOut,
    guests: 1,
    notes: '',
  })
  const [roomForm, setRoomForm] = useState<RoomFormState>({
    name: '',
    capacity: 2,
    pricePerNight: '',
  })

  async function loadRooms() {
    const response = await fetch('/api/rooms', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load rooms.')
    }
    const data = (await response.json()) as Room[]
    setRooms(data)
    setForm((current) => ({
      ...current,
      roomId: current.roomId || String(data[0]?.id ?? ''),
    }))
  }

  async function loadMe() {
    const response = await fetch('/api/me', { cache: 'no-store' })
    if (!response.ok) return
    const data = (await response.json()) as MeSummary
    setActiveRole(data.activeRole || 'CLIENT')
  }

  async function loadBookings() {
    const response = await fetch('/api/bookings', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load bookings.')
    }
    const data = (await response.json()) as Booking[] | { items: Booking[] }
    setBookings(Array.isArray(data) ? data : data.items)
  }

  useEffect(() => {
    let mounted = true

    async function initialize() {
      try {
        setLoading(true)
        await Promise.all([loadMe(), loadRooms(), loadBookings()])
      } catch (loadError) {
        if (!mounted) return
        const message =
          loadError instanceof Error ? loadError.message : 'Failed to initialize booking app.'
        setError(message)
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    void initialize()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (prefillApplied) return
    const guestName = searchParams.get('guestName')?.trim() || ''
    const guestEmail = searchParams.get('guestEmail')?.trim() || ''
    const guestPhone = searchParams.get('guestPhone')?.trim() || ''
    if (!guestName && !guestEmail && !guestPhone) {
      setPrefillApplied(true)
      return
    }

    setForm((current) => ({
      ...current,
      guestName: guestName || current.guestName,
      guestEmail: guestEmail || current.guestEmail,
      guestPhone: guestPhone || current.guestPhone,
    }))
    setPrefillApplied(true)
  }, [prefillApplied, searchParams])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)

    try {
      const payload = {
        roomId: Number(form.roomId),
        guestName: form.guestName,
        guestEmail: form.guestEmail,
        guestPhone: form.guestPhone,
        checkIn: inputDateToIso(form.checkIn),
        checkOut: inputDateToIso(form.checkOut),
        guests: Number(form.guests),
        notes: form.notes,
      }

      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create booking.')
      }

      setForm((current) => ({
        ...current,
        guestName: '',
        guestEmail: '',
        guestPhone: '',
        notes: '',
        guests: 1,
      }))
      setSuccess('Booking created.')
      await loadBookings()
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to create booking.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setCreatingRoom(true)

    try {
      const pricePerNight = Number(roomForm.pricePerNight)
      if (Number.isNaN(pricePerNight) || pricePerNight < 0) {
        throw new Error('Price per night must be zero or a positive number.')
      }

      const payload = {
        name: roomForm.name,
        capacity: Number(roomForm.capacity),
        pricePerNightCents: Math.round(pricePerNight * 100),
      }

      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as { id?: number; error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create booking place.')
      }

      await loadRooms()
      if (data.id) {
        setForm((current) => ({ ...current, roomId: String(data.id) }))
      }
      setRoomForm({
        name: '',
        capacity: 2,
        pricePerNight: '',
      })
      setSuccess('Booking place created.')
    } catch (createRoomError) {
      const message =
        createRoomError instanceof Error
          ? createRoomError.message
          : 'Failed to create booking place.'
      setError(message)
    } finally {
      setCreatingRoom(false)
    }
  }

  function startEdit(booking: Booking) {
    setEditingId(booking.id)
    setEditForm(bookingToEditForm(booking))
    setError(null)
    setSuccess(null)
  }

  function stopEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editForm || editingId === null) return

    setError(null)
    setSuccess(null)
    setUpdatingId(editingId)

    try {
      const payload = {
        roomId: Number(editForm.roomId),
        guestName: editForm.guestName,
        guestEmail: editForm.guestEmail,
        guestPhone: editForm.guestPhone,
        checkIn: inputDateToIso(editForm.checkIn),
        checkOut: inputDateToIso(editForm.checkOut),
        guests: Number(editForm.guests),
        notes: editForm.notes,
        status: editForm.status,
      }

      const response = await fetch(`/api/bookings/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update booking.')
      }

      stopEdit()
      setSuccess('Booking updated.')
      await loadBookings()
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Failed to update booking.'
      setError(message)
    } finally {
      setUpdatingId(null)
    }
  }

  async function handleCancelBooking(bookingId: number) {
    if (!confirm('Cancel this booking?')) {
      return
    }

    setError(null)
    setSuccess(null)
    setCancelingId(bookingId)

    try {
      const response = await fetch(`/api/bookings/${bookingId}`, {
        method: 'DELETE',
      })

      const data = (await response.json()) as { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel booking.')
      }

      if (editingId === bookingId) {
        stopEdit()
      }

      setSuccess('Booking canceled.')
      await loadBookings()
    } catch (cancelError) {
      const message = cancelError instanceof Error ? cancelError.message : 'Failed to cancel booking.'
      setError(message)
    } finally {
      setCancelingId(null)
    }
  }

  return (
    <main className="min-h-screen w-full p-4 md:p-10">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="panel p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Legacy Demo</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">Room-Based Booking Demo (Legacy)</h1>
          <p className="mt-3 text-sm text-[var(--muted)]">
            This is the legacy room-based demo flow. Use the real seat-map booking flow for current product behavior.
          </p>
          <div className="mt-3">
            <Link
              href="/bookings"
              className="inline-flex rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
            >
              Open Seat Map Booking Flow
            </Link>
          </div>
        </header>

        {error ? (
          <div className="panel-strong border-red-400/40 p-4 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="panel-strong border-emerald-400/40 p-4 text-sm text-emerald-700 dark:text-emerald-300">
            {success}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {activeRole === 'TECH_ADMIN' ? (
              <form onSubmit={handleCreateRoom} className="panel flex flex-col gap-4 p-5">
                <h2 className="text-lg font-semibold">Create Booking Place (Legacy Demo)</h2>

                <label className="flex flex-col gap-1 text-sm">
                  Place Name
                  <input
                    className="panel-strong rounded-xl px-3 py-2"
                    value={roomForm.name}
                    onChange={(event) =>
                      setRoomForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Sunset Villa"
                    required
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    Capacity
                    <input
                      className="panel-strong rounded-xl px-3 py-2"
                      type="number"
                      min={1}
                      value={roomForm.capacity}
                      onChange={(event) =>
                        setRoomForm((current) => ({
                          ...current,
                          capacity: Math.max(1, Number(event.target.value || 1)),
                        }))
                      }
                      required
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-sm">
                    Price / Night ($)
                    <input
                      className="panel-strong rounded-xl px-3 py-2"
                      type="number"
                      min={0}
                      step="0.01"
                      value={roomForm.pricePerNight}
                      onChange={(event) =>
                        setRoomForm((current) => ({
                          ...current,
                          pricePerNight: event.target.value,
                        }))
                      }
                      placeholder="149.00"
                      required
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="mt-2 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_35%,transparent)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={creatingRoom}
                >
                  {creatingRoom ? 'Creating Place...' : 'Create Place'}
                </button>
              </form>
            ) : (
              <article className="panel p-5 text-sm text-[var(--muted)]">
                <p className="font-medium text-[var(--text)]">Create Booking Place hidden</p>
                <p className="mt-2">
                  In the current product model, booking places/rooms should be managed by Tech Admin. This legacy form is disabled for your role.
                </p>
              </article>
            )}

            <form onSubmit={handleSubmit} className="panel flex flex-col gap-4 p-5">
            <h2 className="text-lg font-semibold">New Booking (Legacy Room Flow)</h2>

            <label className="flex flex-col gap-1 text-sm">
              Room
              <select
                className="panel-strong rounded-xl px-3 py-2"
                value={form.roomId}
                onChange={(event) => setForm((current) => ({ ...current, roomId: event.target.value }))}
                required
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} · {room.capacity} guests · ${(room.pricePerNightCents / 100).toFixed(2)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Guest Name
              <input
                className="panel-strong rounded-xl px-3 py-2"
                value={form.guestName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guestName: event.target.value }))
                }
                placeholder="Jane Smith"
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Guest Email
              <input
                className="panel-strong rounded-xl px-3 py-2"
                type="email"
                value={form.guestEmail}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guestEmail: event.target.value }))
                }
                placeholder="jane@example.com"
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Guest Phone
              <input
                className="panel-strong rounded-xl px-3 py-2"
                value={form.guestPhone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, guestPhone: event.target.value }))
                }
                placeholder="+77011234567"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Check-In
                <input
                  className="panel-strong rounded-xl px-3 py-2"
                  type="date"
                  value={form.checkIn}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, checkIn: event.target.value }))
                  }
                  required
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                Check-Out
                <input
                  className="panel-strong rounded-xl px-3 py-2"
                  type="date"
                  value={form.checkOut}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, checkOut: event.target.value }))
                  }
                  required
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Guests
              <input
                className="panel-strong rounded-xl px-3 py-2"
                type="number"
                min={1}
                value={form.guests}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    guests: Math.max(1, Number(event.target.value || 1)),
                  }))
                }
                required
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Notes
              <textarea
                className="panel-strong min-h-[84px] rounded-xl px-3 py-2"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Late check-in request"
              />
            </label>

            <button
              type="submit"
              className="mt-2 rounded-xl border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_35%,transparent)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting || loading || rooms.length === 0}
            >
              {submitting ? 'Creating...' : 'Create Booking'}
            </button>
          </form>
          </div>

          <section className="panel p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Upcoming Bookings</h2>
              <span className="chip">{bookings.length} total</span>
            </div>

            {loading ? (
              <p className="text-sm text-[var(--muted)]">Loading bookings...</p>
            ) : bookings.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No bookings yet.</p>
            ) : (
              <div className="space-y-3">
                {bookings.map((booking) => (
                  <article key={booking.id} className="panel-strong rounded-xl p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-base font-semibold">{booking.guestName}</p>
                        <p className="text-xs text-[var(--muted)]">{booking.guestEmail}</p>
                      </div>
                      <span className="chip">{booking.status}</span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <p>
                        <span className="text-[var(--muted)]">Room:</span> {booking.room.name}
                      </p>
                      <p>
                        <span className="text-[var(--muted)]">Guests:</span> {booking.guests}
                      </p>
                      <p className="md:col-span-2">
                        <span className="text-[var(--muted)]">Dates:</span>{' '}
                        {formatDateRange(booking.checkIn, booking.checkOut)}
                      </p>
                      {booking.notes ? (
                        <p className="md:col-span-2">
                          <span className="text-[var(--muted)]">Notes:</span> {booking.notes}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                        onClick={() => startEdit(booking)}
                        disabled={updatingId === booking.id || cancelingId === booking.id}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-400/40 px-3 py-1 text-xs text-red-700 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
                        onClick={() => handleCancelBooking(booking.id)}
                        disabled={
                          booking.status === 'CANCELED' ||
                          updatingId === booking.id ||
                          cancelingId === booking.id
                        }
                      >
                        {cancelingId === booking.id ? 'Canceling...' : 'Cancel'}
                      </button>
                    </div>

                    {editingId === booking.id && editForm ? (
                      <form onSubmit={handleSaveEdit} className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs">
                            Room
                            <select
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              value={editForm.roomId}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current ? { ...current, roomId: event.target.value } : current,
                                )
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

                          <label className="flex flex-col gap-1 text-xs">
                            Status
                            <select
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              value={editForm.status}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current
                                    ? {
                                        ...current,
                                        status: event.target.value as BookingStatus,
                                      }
                                    : current,
                                )
                              }
                            >
                              <option value="PENDING">PENDING</option>
                              <option value="HELD">HELD</option>
                              <option value="CONFIRMED">CONFIRMED</option>
                              <option value="CHECKED_IN">CHECKED_IN</option>
                              <option value="CANCELED">CANCELED</option>
                              <option value="COMPLETED">COMPLETED</option>
                              <option value="NO_SHOW">NO_SHOW</option>
                            </select>
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-1 text-xs">
                            Guest Name
                            <input
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              value={editForm.guestName}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current ? { ...current, guestName: event.target.value } : current,
                                )
                              }
                              required
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-xs">
                            Guest Email
                            <input
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              type="email"
                              value={editForm.guestEmail}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current ? { ...current, guestEmail: event.target.value } : current,
                                )
                              }
                              required
                            />
                          </label>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="flex flex-col gap-1 text-xs">
                            Check-In
                            <input
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              type="date"
                              value={editForm.checkIn}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current ? { ...current, checkIn: event.target.value } : current,
                                )
                              }
                              required
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-xs">
                            Check-Out
                            <input
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              type="date"
                              value={editForm.checkOut}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current ? { ...current, checkOut: event.target.value } : current,
                                )
                              }
                              required
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-xs">
                            Guests
                            <input
                              className="panel-strong rounded-lg px-2 py-1 text-sm"
                              type="number"
                              min={1}
                              value={editForm.guests}
                              onChange={(event) =>
                                setEditForm((current) =>
                                  current
                                    ? {
                                        ...current,
                                        guests: Math.max(1, Number(event.target.value || 1)),
                                      }
                                    : current,
                                )
                              }
                              required
                            />
                          </label>
                        </div>

                        <label className="flex flex-col gap-1 text-xs">
                          Notes
                          <textarea
                            className="panel-strong min-h-[70px] rounded-lg px-2 py-1 text-sm"
                            value={editForm.notes}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, notes: event.target.value } : current,
                              )
                            }
                          />
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="submit"
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                            disabled={updatingId === booking.id}
                          >
                            {updatingId === booking.id ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                            onClick={stopEdit}
                            disabled={updatingId === booking.id}
                          >
                            Cancel Edit
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}
