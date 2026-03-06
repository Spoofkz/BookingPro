'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  activeClubId: string | null
  memberships?: Array<{
    clubId: string | null
    role: string
    status: string
  }>
}

type CustomerNote = {
  noteId: string
  text: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
  createdBy: {
    id: string
    name: string
  } | null
}

type CustomerTag = {
  id: string
  tag: string
  createdAt: string
}

type CustomerVisit = {
  bookingId: number
  checkIn: string
  checkOut: string
  status: string
  paymentStatus: string
  seatId: string | null
  seatLabel: string | null
  room: {
    id: number
    name: string
  }
  totalCents: number | null
  currency: string | null
  channel: string
  customerType: string
}

type CustomerProfileResponse = {
  customerId: string
  displayName: string | null
  phone: string | null
  phoneMasked: string | null
  email: string | null
  emailMasked: string | null
  revealPii?: boolean
  status: string
  isBlocked: boolean
  blockedAt: string | null
  requiresAttention: boolean
  attentionReason: string | null
  source: string
  createdBy: {
    id: string
    name: string
  } | null
  possibleDuplicates: number
  createdAt: string
  updatedAt: string
  linkedUser: {
    id: string
    name: string
    phone: string | null
    email: string | null
  } | null
  stats: {
    totalBookings: number
    upcomingBookingsCount: number
    cancelCount: number
    noShowCount: number
    lifetimeSpendCents: number | null
    lastVisitAt: string | null
    preferredSegmentId: string | null
    preferredSeatId: string | null
  }
  tags: CustomerTag[]
  notes: CustomerNote[]
  upcomingVisits: CustomerVisit[]
  pastVisitsPage: number
  pastVisitsPageSize: number
  visits: CustomerVisit[]
}

type TabKey = 'overview' | 'visits' | 'notes'

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function formatMoney(cents: number | null, currency: string | null) {
  if (typeof cents !== 'number' || cents < 0) return '—'
  const amount = cents / 100
  if (!currency) return amount.toFixed(2)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return amount.toFixed(2)
  }
}

export default function HostCustomerProfile({ customerId }: { customerId: string }) {
  const [activeClubId, setActiveClubId] = useState<string | null>(null)
  const [isTechAdmin, setIsTechAdmin] = useState(false)
  const [revealPii, setRevealPii] = useState(false)
  const [profile, setProfile] = useState<CustomerProfileResponse | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [visitsPage, setVisitsPage] = useState(1)
  const visitsPageSize = 25
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const [newNote, setNewNote] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [attentionReasonDraft, setAttentionReasonDraft] = useState('')
  const [mergeTargetCustomerId, setMergeTargetCustomerId] = useState('')
  const [mergeReason, setMergeReason] = useState('')

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const meResponse = await fetch('/api/me', { cache: 'no-store' })
      const mePayload = (await meResponse.json()) as MeResponse | { error?: string }
      if (!meResponse.ok) {
        throw new Error((mePayload as { error?: string }).error || 'Failed to load cabinet context.')
      }
      const me = mePayload as MeResponse
      setActiveClubId(me.activeClubId)
      if (!me.activeClubId) {
        throw new Error('Active club context is required.')
      }
      const techAdmin = Boolean(
        me.memberships?.some(
          (membership) =>
            membership.clubId === me.activeClubId &&
            membership.status === 'ACTIVE' &&
            membership.role === 'TECH_ADMIN',
        ),
      )
      setIsTechAdmin(techAdmin)
      const canReveal = techAdmin && revealPii

      const response = await fetch(
        `/api/customers/${customerId}?visitsPage=${visitsPage}&visitsPageSize=${visitsPageSize}&revealPII=${
          canReveal ? 'true' : 'false'
        }`,
        {
          cache: 'no-store',
          headers: {
            'X-Club-Id': me.activeClubId,
          },
        },
      )
      const payload = (await response.json()) as CustomerProfileResponse | { error?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load customer profile.')
      }
      const loadedProfile = payload as CustomerProfileResponse
      setProfile(loadedProfile)
      setAttentionReasonDraft(loadedProfile.attentionReason || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load customer profile.')
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [customerId, revealPii, visitsPage, visitsPageSize])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  useEffect(() => {
    setVisitsPage(1)
  }, [customerId])

  const quickBookingHref = useMemo(() => {
    if (!profile) return '/bookings'
    return `/bookings?guestName=${encodeURIComponent(profile.displayName || '')}&guestPhone=${encodeURIComponent(
      profile.revealPii ? profile.phone || '' : '',
    )}&guestEmail=${encodeURIComponent(profile.revealPii ? profile.email || '' : '')}`
  }, [profile])

  const canCallOrMessage = useMemo(() => {
    if (!profile?.phone) return false
    return profile.revealPii === true
  }, [profile])

  async function runWithClub(
    path: string,
    init: RequestInit,
    fallbackError: string,
  ) {
    if (!activeClubId) {
      throw new Error('Active club context is required.')
    }
    const headers = new Headers(init.headers)
    headers.set('X-Club-Id', activeClubId)
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers,
    })
    const payload = (await response.json()) as Record<string, unknown>
    if (!response.ok) {
      throw new Error((payload.error as string | undefined) || fallbackError)
    }
    return payload
  }

  async function handleAddTag() {
    if (!profile) return
    const tag = newTag.trim()
    if (!tag) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/tags`,
        {
          method: 'POST',
          body: JSON.stringify({ tag }),
        },
        'Failed to add tag.',
      )
      setNewTag('')
      setMessage('Tag added.')
      await loadProfile()
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to add tag.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveTag(tag: string) {
    if (!profile) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/tags/${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
        'Failed to remove tag.',
      )
      setMessage('Tag removed.')
      await loadProfile()
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : 'Failed to remove tag.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddNote() {
    if (!profile) return
    const text = newNote.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ text }),
        },
        'Failed to add note.',
      )
      setNewNote('')
      setMessage('Note added.')
      await loadProfile()
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : 'Failed to add note.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePinNote(noteId: string, isPinned: boolean) {
    if (!profile) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/notes/${noteId}/pin`,
        {
          method: 'POST',
          body: JSON.stringify({ isPinned: !isPinned }),
        },
        'Failed to update note pin.',
      )
      setMessage(!isPinned ? 'Note pinned.' : 'Note unpinned.')
      await loadProfile()
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : 'Failed to update note pin.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (!profile) return
    if (!confirm('Delete this note?')) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/notes/${noteId}`,
        { method: 'DELETE' },
        'Failed to delete note.',
      )
      setMessage('Note deleted.')
      await loadProfile()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete note.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveEditedNote() {
    if (!profile || !editingNoteId) return
    const text = editingNoteText.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}/notes/${editingNoteId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ text }),
        },
        'Failed to update note.',
      )
      setEditingNoteId(null)
      setEditingNoteText('')
      setMessage('Note updated.')
      await loadProfile()
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Failed to update note.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRiskUpdate(patch: Record<string, unknown>, successMessage: string) {
    if (!profile) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        `/api/customers/${profile.customerId}`,
        {
          method: 'PUT',
          body: JSON.stringify(patch),
        },
        'Failed to update customer risk settings.',
      )
      setMessage(successMessage)
      await loadProfile()
    } catch (riskError) {
      setError(riskError instanceof Error ? riskError.message : 'Failed to update customer risk settings.')
    } finally {
      setBusy(false)
    }
  }

  async function handleMerge() {
    if (!profile || !isTechAdmin) return
    const targetId = mergeTargetCustomerId.trim()
    if (!targetId) return
    if (!confirm(`Merge customer ${targetId} into ${profile.customerId}?`)) return

    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await runWithClub(
        '/api/customers/merge',
        {
          method: 'POST',
          body: JSON.stringify({
            primaryCustomerId: profile.customerId,
            mergedCustomerId: targetId,
            reason: mergeReason.trim() || null,
          }),
        },
        'Failed to merge customers.',
      )
      setMergeTargetCustomerId('')
      setMergeReason('')
      setMessage('Customer merge completed.')
      await loadProfile()
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Failed to merge customers.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading customer profile...</p>
  }

  if (error && !profile) {
    return (
      <div className="space-y-3">
        <Link href="/cabinet/host/customers" className="text-sm underline">
          Back to customers
        </Link>
        <article className="panel-strong rounded-lg border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="space-y-3">
        <Link href="/cabinet/host/customers" className="text-sm underline">
          Back to customers
        </Link>
        <p className="text-sm text-[var(--muted)]">Customer not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Link href="/cabinet/host/customers" className="text-sm underline">
            Back to customers
          </Link>
          <h2 className="text-2xl font-semibold">
            {profile.displayName || profile.phone || profile.email || 'Customer'}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {(profile.phoneMasked || profile.phone || 'No phone')} {profile.emailMasked ? `• ${profile.emailMasked}` : ''}
          </p>
          <p className="text-xs text-[var(--muted)]">
            ID: {profile.customerId} · Source: {profile.source} · Created {formatDate(profile.createdAt)}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Status: {profile.status} {profile.isBlocked ? '• Blocked' : ''}{' '}
            {profile.requiresAttention ? '• Attention' : ''}{' '}
            {profile.possibleDuplicates > 0 ? `• ${profile.possibleDuplicates} possible duplicate(s)` : ''}
          </p>
          {profile.linkedUser ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Linked user: {profile.linkedUser.name} ({profile.linkedUser.id})
            </p>
          ) : (
            <p className="text-xs text-[var(--muted)]">Not linked to an online account</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={quickBookingHref}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
          >
            + Create booking
          </Link>
          {isTechAdmin ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => setRevealPii((prev) => !prev)}
            >
              {revealPii ? 'Hide full contact' : 'Reveal full contact'}
            </button>
          ) : null}
          {canCallOrMessage ? (
            <a
              href={`tel:${profile.phone}`}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
            >
              Call
            </a>
          ) : null}
          {canCallOrMessage ? (
            <a
              href={`https://wa.me/${encodeURIComponent((profile.phone || '').replace(/[^\d]/g, ''))}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
            >
              WhatsApp
            </a>
          ) : null}
        </div>
      </div>

      {error ? (
        <article className="panel-strong rounded-lg border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      ) : null}
      {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'overview' ? 'border-emerald-500' : 'border-[var(--border)]'}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'visits' ? 'border-emerald-500' : 'border-[var(--border)]'}`}
          onClick={() => setTab('visits')}
        >
          Visits
        </button>
        <button
          type="button"
          className={`rounded-lg border px-3 py-1 text-sm ${tab === 'notes' ? 'border-emerald-500' : 'border-[var(--border)]'}`}
          onClick={() => setTab('notes')}
        >
          Notes
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">Total bookings</p>
              <p className="text-xl font-semibold">{profile.stats.totalBookings}</p>
            </article>
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">Upcoming</p>
              <p className="text-xl font-semibold">{profile.stats.upcomingBookingsCount}</p>
            </article>
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">Canceled</p>
              <p className="text-xl font-semibold">{profile.stats.cancelCount}</p>
            </article>
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">No-show</p>
              <p className="text-xl font-semibold">{profile.stats.noShowCount}</p>
            </article>
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">Last visit</p>
              <p className="text-sm font-medium">{formatDate(profile.stats.lastVisitAt)}</p>
            </article>
            <article className="panel-strong p-3">
              <p className="text-xs text-[var(--muted)]">Lifetime spend</p>
              <p className="text-sm font-medium">
                {formatMoney(profile.stats.lifetimeSpendCents, profile.upcomingVisits[0]?.currency || profile.visits[0]?.currency || null)}
              </p>
            </article>
          </div>

          <article className="panel-strong p-3 text-sm">
            <p className="font-medium">Risk / attention</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                disabled={busy}
                onClick={() =>
                  void handleRiskUpdate(
                    { requiresAttention: !profile.requiresAttention, attentionReason: attentionReasonDraft || null },
                    profile.requiresAttention ? 'Attention flag removed.' : 'Attention flag enabled.',
                  )
                }
              >
                {profile.requiresAttention ? 'Remove attention flag' : 'Mark requires attention'}
              </button>
              {isTechAdmin ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    void handleRiskUpdate(
                      { isBlocked: !profile.isBlocked },
                      profile.isBlocked ? 'Customer unblocked.' : 'Customer blocked.',
                    )
                  }
                >
                  {profile.isBlocked ? 'Unblock customer' : 'Block customer'}
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="panel flex-1 rounded-lg px-3 py-2 text-sm"
                value={attentionReasonDraft}
                onChange={(event) => setAttentionReasonDraft(event.target.value)}
                placeholder="Attention reason (optional)"
                maxLength={240}
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                disabled={busy}
                onClick={() =>
                  void handleRiskUpdate(
                    { requiresAttention: profile.requiresAttention, attentionReason: attentionReasonDraft || null },
                    'Attention reason updated.',
                  )
                }
              >
                Save reason
              </button>
            </div>
            {profile.attentionReason ? (
              <p className="mt-2 text-xs text-[var(--muted)]">Current reason: {profile.attentionReason}</p>
            ) : null}
          </article>

          <article className="panel-strong p-3 text-sm">
            <p className="font-medium">Tag management</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.tags.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">No tags yet.</p>
              ) : (
                profile.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    {tag.tag}
                    <button
                      type="button"
                      className="text-red-600 dark:text-red-300 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void handleRemoveTag(tag.tag)}
                    >
                      remove
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="panel flex-1 rounded-lg px-3 py-2 text-sm"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                placeholder="VIP, No-show risk, Pays cash"
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                disabled={busy}
                onClick={() => void handleAddTag()}
              >
                Add tag
              </button>
            </div>
          </article>

          <article className="panel-strong p-3 text-sm">
            <p className="text-xs text-[var(--muted)]">Preferred segment</p>
            <p className="font-medium">{profile.stats.preferredSegmentId || '—'}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">Preferred seat</p>
            <p className="font-medium">{profile.stats.preferredSeatId || '—'}</p>
          </article>

          {isTechAdmin ? (
            <article className="panel-strong p-3 text-sm">
              <p className="font-medium">Merge duplicate customer (CTA)</p>
              <p className="text-xs text-[var(--muted)]">
                This operation moves bookings, notes, tags, and membership references to the primary profile.
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input
                  className="panel rounded-lg px-3 py-2 text-sm"
                  value={mergeTargetCustomerId}
                  onChange={(event) => setMergeTargetCustomerId(event.target.value)}
                  placeholder="Secondary customer ID"
                />
                <input
                  className="panel rounded-lg px-3 py-2 text-sm"
                  value={mergeReason}
                  onChange={(event) => setMergeReason(event.target.value)}
                  placeholder="Reason (optional)"
                />
              </div>
              <button
                type="button"
                className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                disabled={busy || !mergeTargetCustomerId.trim()}
                onClick={() => void handleMerge()}
              >
                Merge into this customer
              </button>
            </article>
          ) : null}
        </div>
      ) : null}

      {tab === 'visits' ? (
        <div className="space-y-3">
          <article className="panel-strong p-3 text-sm">
            <p className="font-medium">Upcoming bookings</p>
            {profile.upcomingVisits.length < 1 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">No upcoming bookings.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {profile.upcomingVisits.map((visit) => (
                  <div key={`upcoming:${visit.bookingId}`} className="rounded-lg border border-[var(--border)] p-2 text-xs">
                    <p className="font-medium">
                      Booking #{visit.bookingId} · {visit.room.name}
                    </p>
                    <p className="text-[var(--muted)]">
                      {formatDate(visit.checkIn)} - {formatDate(visit.checkOut)}
                    </p>
                    <p>
                      {visit.status} · payment {visit.paymentStatus} · seat {visit.seatLabel || visit.seatId || '—'}
                    </p>
                    <p className="text-[var(--muted)]">
                      Total {formatMoney(visit.totalCents, visit.currency)} · {visit.channel} · {visit.customerType}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel-strong p-3 text-sm">
            <p className="font-medium">Past bookings</p>
            {profile.visits.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">No past visits yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {profile.visits.map((visit) => (
                  <div key={visit.bookingId} className="rounded-lg border border-[var(--border)] p-2 text-xs">
                    <p className="font-medium">
                      Booking #{visit.bookingId} · {visit.room.name}
                    </p>
                    <p className="text-[var(--muted)]">
                      {formatDate(visit.checkIn)} - {formatDate(visit.checkOut)}
                    </p>
                    <p>
                      {visit.status} · payment {visit.paymentStatus} · seat {visit.seatLabel || visit.seatId || '—'}
                    </p>
                    <p className="text-[var(--muted)]">
                      Total {formatMoney(visit.totalCents, visit.currency)} · {visit.channel} · {visit.customerType}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between text-xs">
              <span>Past page {visitsPage}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                  disabled={busy || visitsPage <= 1}
                  onClick={() => setVisitsPage((prev) => Math.max(1, prev - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                  disabled={busy || profile.visits.length < visitsPageSize}
                  onClick={() => setVisitsPage((prev) => prev + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </article>
        </div>
      ) : null}

      {tab === 'notes' ? (
        <div className="space-y-3">
          <article className="panel-strong p-3 text-xs text-amber-700 dark:text-amber-300">
            Do not store sensitive personal data.
          </article>
          <div className="flex gap-2">
            <textarea
              className="panel min-h-[96px] flex-1 rounded-lg px-3 py-2 text-sm"
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder="Behavior notes, preferences, operational reminders..."
              maxLength={1000}
            />
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 self-start"
              disabled={busy}
              onClick={() => void handleAddNote()}
            >
              Add note
            </button>
          </div>
          {profile.notes.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No notes yet.</p>
          ) : (
            profile.notes.map((note) => (
              <article key={note.noteId} className="panel-strong p-3 text-sm">
                {editingNoteId === note.noteId ? (
                  <textarea
                    className="panel min-h-[88px] w-full rounded-lg px-3 py-2 text-sm"
                    value={editingNoteText}
                    onChange={(event) => setEditingNoteText(event.target.value)}
                    maxLength={1000}
                  />
                ) : (
                  <p>{note.text}</p>
                )}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {note.createdBy?.name || 'Unknown'} · {formatDate(note.createdAt)}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void handlePinNote(note.noteId, note.isPinned)}
                  >
                    {note.isPinned ? 'Unpin' : 'Pin'}
                  </button>
                  {editingNoteId === note.noteId ? (
                    <>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                        disabled={busy || !editingNoteText.trim()}
                        onClick={() => void handleSaveEditedNote()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          setEditingNoteId(null)
                          setEditingNoteText('')
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setEditingNoteId(note.noteId)
                        setEditingNoteText(note.text)
                      }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-red-700 hover:bg-white/10 disabled:opacity-50 dark:text-red-300"
                    disabled={busy}
                    onClick={() => void handleDeleteNote(note.noteId)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
