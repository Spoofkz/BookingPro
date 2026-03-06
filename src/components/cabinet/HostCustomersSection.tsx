'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type CustomerListItem = {
  customerId: string
  displayName: string | null
  phone: string | null
  phoneMasked: string | null
  email: string | null
  emailMasked: string | null
  status: string
  isBlocked: boolean
  requiresAttention: boolean
  attentionReason: string | null
  lastVisitAt: string | null
  totalBookings: number
  upcomingBookings: number
  noShowCount: number
  possibleDuplicates: boolean
  tags: string[]
}

type CustomersResponse = {
  items: CustomerListItem[]
  availableTags: string[]
  page: number
  pageSize: number
  total: number
}

type Props = {
  activeClubId: string
}

function formatLastVisit(value: string | null) {
  if (!value) return 'No visits'
  return new Date(value).toLocaleString()
}

export default function HostCustomersSection({ activeClubId }: Props) {
  const [query, setQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [lastVisitFrom, setLastVisitFrom] = useState('')
  const [lastVisitTo, setLastVisitTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [hasUpcoming, setHasUpcoming] = useState('')
  const [noShowRange, setNoShowRange] = useState('')
  const [sort, setSort] = useState('newest_activity')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<CustomerListItem[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 25

  const queryString = useMemo(() => {
    const search = new URLSearchParams()
    if (query.trim()) search.set('q', query.trim())
    if (selectedTag) search.set('tag', selectedTag)
    if (statusFilter) search.set('status', statusFilter)
    if (hasUpcoming) search.set('hasUpcoming', hasUpcoming)
    if (noShowRange) search.set('noShowRange', noShowRange)
    if (sort) search.set('sort', sort)
    if (lastVisitFrom) search.set('lastVisitFrom', `${lastVisitFrom}T00:00:00.000Z`)
    if (lastVisitTo) search.set('lastVisitTo', `${lastVisitTo}T23:59:59.999Z`)
    search.set('page', String(page))
    search.set('pageSize', String(pageSize))
    return search.toString()
  }, [
    hasUpcoming,
    lastVisitFrom,
    lastVisitTo,
    noShowRange,
    page,
    query,
    selectedTag,
    sort,
    statusFilter,
    pageSize,
  ])

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/customers?${queryString}`, {
        cache: 'no-store',
        headers: {
          'X-Club-Id': activeClubId,
        },
      })
      const payload = (await response.json()) as CustomersResponse | { error?: string }
      if (!response.ok) {
        const errorMessage =
          typeof (payload as { error?: unknown }).error === 'string'
            ? (payload as { error: string }).error
            : 'Failed to load customers.'
        throw new Error(errorMessage)
      }
      const data = payload as CustomersResponse
      setItems(data.items || [])
      setAvailableTags(data.availableTags || [])
      setTotal(typeof data.total === 'number' ? data.total : 0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load customers.')
      setItems([])
      setAvailableTags([])
      setTotal(0)
    } finally {
      setLoading(false)
      setSubmitting(false)
    }
  }, [activeClubId, queryString])

  useEffect(() => {
    void loadCustomers()
  }, [loadCustomers])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (page !== 1) {
      setPage(1)
      return
    }
    setSubmitting(true)
    void loadCustomers()
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Customers</h2>
      <p className="text-xs text-[var(--muted)]">
        Search by name or phone. Contact fields in list are masked by default for privacy.
      </p>
      <form className="grid gap-3 md:grid-cols-8" onSubmit={onSubmit}>
        <label className="md:col-span-2 flex flex-col gap-1 text-sm">
          Search (name/phone/email/id)
          <input
            className="panel rounded-lg px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Aruzhan, +7701..., 9999"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            className="panel rounded-lg px-3 py-2"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
            <option value="flagged">Flagged</option>
            <option value="merged">Merged</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Upcoming
          <select
            className="panel rounded-lg px-3 py-2"
            value={hasUpcoming}
            onChange={(event) => setHasUpcoming(event.target.value)}
          >
            <option value="">Any</option>
            <option value="true">Has upcoming</option>
            <option value="false">No upcoming</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          No-shows
          <select
            className="panel rounded-lg px-3 py-2"
            value={noShowRange}
            onChange={(event) => setNoShowRange(event.target.value)}
          >
            <option value="">Any</option>
            <option value="0">0</option>
            <option value="1-2">1-2</option>
            <option value="3+">3+</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sort
          <select
            className="panel rounded-lg px-3 py-2"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest_activity">Newest activity</option>
            <option value="most_bookings">Most bookings</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tag
          <select
            className="panel rounded-lg px-3 py-2"
            value={selectedTag}
            onChange={(event) => setSelectedTag(event.target.value)}
          >
            <option value="">All</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Last visit from
          <input
            type="date"
            className="panel rounded-lg px-3 py-2"
            value={lastVisitFrom}
            onChange={(event) => setLastVisitFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Last visit to
          <input
            type="date"
            className="panel rounded-lg px-3 py-2"
            value={lastVisitTo}
            onChange={(event) => setLastVisitTo(event.target.value)}
          />
        </label>
        <div className="md:col-span-8 flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? 'Searching...' : 'Search'}
          </button>
          <Link
            href="/bookings"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
          >
            + Create booking
          </Link>
        </div>
      </form>

      {error ? (
        <article className="panel-strong rounded-lg border-red-400/40 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading customers...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No customers found for current filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last Visit</th>
                <th className="px-3 py-2">Visits</th>
                <th className="px-3 py-2">Upcoming</th>
                <th className="px-3 py-2">No-show</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const name = item.displayName || item.phoneMasked || item.emailMasked || 'Unnamed customer'
                const quickBookingHref = `/bookings?guestName=${encodeURIComponent(
                  item.displayName || '',
                )}&guestPhone=${encodeURIComponent(item.phone || '')}&guestEmail=${encodeURIComponent(
                  item.email || '',
                )}`

                return (
                  <tr key={item.customerId} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{name}</div>
                      {item.emailMasked ? (
                        <div className="text-xs text-[var(--muted)]">{item.emailMasked}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{item.phoneMasked || item.phone || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {item.isBlocked ? (
                        <span className="rounded-full border border-red-500/40 px-2 py-0.5 text-red-700 dark:text-red-300">
                          Blocked
                        </span>
                      ) : item.requiresAttention ? (
                        <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                          Attention
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                          Active
                        </span>
                      )}
                      {item.possibleDuplicates ? (
                        <div className="mt-1 text-amber-700 dark:text-amber-300">Possible duplicate</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{formatLastVisit(item.lastVisitAt)}</td>
                    <td className="px-3 py-2">{item.totalBookings}</td>
                    <td className="px-3 py-2">{item.upcomingBookings}</td>
                    <td className="px-3 py-2">{item.noShowCount}</td>
                    <td className="px-3 py-2">
                      {item.tags.length === 0 ? (
                        <span className="text-xs text-[var(--muted)]">No tags</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.map((tag) => (
                            <span
                              key={`${item.customerId}:${tag}`}
                              className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/cabinet/host/customers/${item.customerId}`}
                          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                        >
                          Open profile
                        </Link>
                        <Link
                          href={quickBookingHref}
                          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                        >
                          + Create booking
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-xs">
            <span>
              Page {page} of {totalPages} · {total} customers
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
