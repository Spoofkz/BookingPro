'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type DiscoveryCard = {
  clubId: string
  slug: string
  name: string
  coverImageUrl: string | null
  area: string | null
  city: string | null
  startingFrom: {
    amount: number
    currency: string
    segment: string | null
  } | null
  amenities: string[]
  openNow: boolean
  nextSlotAt: string | null
  isFeatured: boolean
  featuredRank: number | null
  featuredBadge: string | null
  seatCount: number
  distanceKm: number | null
}

type DiscoveryResponse = {
  items: DiscoveryCard[]
  featured: DiscoveryCard[]
  total: number
  nextCursor: string | null
}

type SortValue = 'recommended' | 'nearest' | 'price_asc' | 'soonest' | 'capacity'

const AMENITY_OPTIONS = [
  'bootcamp',
  'vip',
  'console',
  'vr',
  'food',
  'parking',
  '24-7',
]

function formatDate(value: string | null) {
  if (!value) return 'No upcoming slots'
  return new Date(value).toLocaleString()
}

function formatDistance(value: number | null) {
  if (value == null) return null
  return `${value.toFixed(1)} km`
}

function sanitizeNumberInput(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed
}

function parseCoordinateInput(value: string) {
  const normalized = value.trim()
  if (!normalized) return undefined
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function defaultDateValue() {
  const date = new Date()
  return date.toISOString().slice(0, 10)
}

export default function PublicClubDiscovery() {
  const [q, setQ] = useState('')
  const [city, setCity] = useState('')
  const [area, setArea] = useState('')
  const [openNow, setOpenNow] = useState(false)
  const [date, setDate] = useState(defaultDateValue())
  const [useDateFilter, setUseDateFilter] = useState(false)
  const [timeFrom, setTimeFrom] = useState('')
  const [timeTo, setTimeTo] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [sort, setSort] = useState<SortValue>('recommended')
  const [amenities, setAmenities] = useState<string[]>([])
  const [locationBusy, setLocationBusy] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  const [items, setItems] = useState<DiscoveryCard[]>([])
  const [featured, setFeatured] = useState<DiscoveryCard[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        q,
        city,
        area,
        openNow,
        date: useDateFilter ? date : '',
        timeFrom,
        timeTo,
        priceMin,
        priceMax,
        lat,
        lng,
        sort,
        amenities,
      }),
    [
      amenities,
      area,
      city,
      date,
      lat,
      lng,
      openNow,
      priceMax,
      priceMin,
      q,
      sort,
      timeFrom,
      timeTo,
      useDateFilter,
    ],
  )

  async function sendEvent(
    eventType: string,
    clubId?: string,
    payload?: Record<string, unknown>,
  ) {
    try {
      await fetch('/api/clubs/public/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, clubId, payload }),
      })
    } catch {
      // Best-effort analytics.
    }
  }

  function buildSearchParams(cursor?: string | null) {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (city.trim()) params.set('city', city.trim())
    if (area.trim()) params.set('area', area.trim())
    if (openNow) params.set('openNow', 'true')
    if (useDateFilter && date) params.set('date', date)
    if (timeFrom) params.set('timeFrom', timeFrom)
    if (timeTo) params.set('timeTo', timeTo)
    if (amenities.length > 0) params.set('amenities', amenities.join(','))

    const min = sanitizeNumberInput(priceMin)
    const max = sanitizeNumberInput(priceMax)
    const latValue = parseCoordinateInput(lat)
    const lngValue = parseCoordinateInput(lng)
    if (min != null) params.set('priceMin', String(min))
    if (max != null) params.set('priceMax', String(max))
    if (latValue != null && lngValue != null) {
      params.set('lat', String(latValue))
      params.set('lng', String(lngValue))
    }

    params.set('sort', sort)
    params.set('pageSize', '12')
    if (cursor) params.set('cursor', cursor)
    return params
  }

  async function loadClubs() {
    setLoading(true)
    setError(null)
    try {
      const params = buildSearchParams()
      const response = await fetch(`/api/clubs/public?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as DiscoveryResponse | { error?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load clubs.')
      }
      const data = payload as DiscoveryResponse
      setItems(data.items)
      setFeatured(data.featured)
      setTotal(data.total)
      setNextCursor(data.nextCursor)
      if (data.items.length > 0) {
        void sendEvent('impression', undefined, {
          clubIds: data.items.map((item) => item.clubId),
          total: data.total,
        })
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load clubs.')
      setItems([])
      setFeatured([])
      setNextCursor(null)
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const params = buildSearchParams(nextCursor)
      const response = await fetch(`/api/clubs/public?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as DiscoveryResponse | { error?: string }
      if (!response.ok) {
        throw new Error((payload as { error?: string }).error || 'Failed to load more clubs.')
      }
      const data = payload as DiscoveryResponse
      setItems((current) => [...current, ...data.items])
      setNextCursor(data.nextCursor)
      if (data.items.length > 0) {
        void sendEvent('impression', undefined, {
          clubIds: data.items.map((item) => item.clubId),
          append: true,
        })
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load more clubs.')
    } finally {
      setLoadingMore(false)
    }
  }

  // Filter changes are intentionally tracked via the serialized signature.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const handle = setTimeout(() => {
      void loadClubs()
      void sendEvent('filters_changed', undefined, {
        q,
        city,
        area,
        openNow,
        date: useDateFilter ? date : null,
        sort,
        amenities,
        hasCoordinates:
          parseCoordinateInput(lat) != null &&
          parseCoordinateInput(lng) != null,
      })
    }, 250)
    return () => clearTimeout(handle)
  }, [filterSignature])
  /* eslint-enable react-hooks/exhaustive-deps */

  function toggleAmenity(value: string) {
    setAmenities((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  function clearCoordinates() {
    setLat('')
    setLng('')
    setLocationError(null)
  }

  function handleUseMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.')
      return
    }

    setLocationBusy(true)
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6))
        setLng(position.coords.longitude.toFixed(6))
        setLocationBusy(false)
      },
      (geoError) => {
        setLocationError(geoError.message || 'Unable to determine your location.')
        setLocationBusy(false)
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 60000,
      },
    )
  }

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto w-full max-w-[1800px] space-y-4">
        <header className="panel p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Search & Discovery</p>
          <h1 className="mt-2 text-3xl font-semibold">Find a Club</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Browse published clubs, filter by availability and price, then start booking.
          </p>
        </header>

        <section className="panel-strong space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Search
              <input
                className="panel rounded-lg px-3 py-2"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Club name, bootcamp, vip..."
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              City
              <input
                className="panel rounded-lg px-3 py-2"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="Almaty"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Area
              <input
                className="panel rounded-lg px-3 py-2"
                value={area}
                onChange={(event) => setArea(event.target.value)}
                placeholder="Mega district"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sort
              <select
                className="panel rounded-lg px-3 py-2"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortValue)}
              >
                <option value="recommended">Recommended</option>
                <option value="nearest">Nearest</option>
                <option value="price_asc">Price: low to high</option>
                <option value="soonest">Soonest availability</option>
                <option value="capacity">Most seats</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={openNow}
                onChange={(event) => setOpenNow(event.target.checked)}
              />
              Open now
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useDateFilter}
                onChange={(event) => setUseDateFilter(event.target.checked)}
              />
              Has slots on date
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date
              <input
                className="panel rounded-lg px-3 py-2"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={!useDateFilter}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Time from
              <input
                className="panel rounded-lg px-3 py-2"
                type="time"
                value={timeFrom}
                onChange={(event) => setTimeFrom(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Time to
              <input
                className="panel rounded-lg px-3 py-2"
                type="time"
                value={timeTo}
                onChange={(event) => setTimeTo(event.target.value)}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Price min
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={0}
                value={priceMin}
                onChange={(event) => setPriceMin(event.target.value)}
                placeholder="5000"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Price max
              <input
                className="panel rounded-lg px-3 py-2"
                type="number"
                min={0}
                value={priceMax}
                onChange={(event) => setPriceMax(event.target.value)}
                placeholder="15000"
              />
            </label>
            <div className="space-y-2 text-sm">
              <p className="text-[var(--muted)]">Coordinates (for nearest sort)</p>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={lat}
                  onChange={(event) => setLat(event.target.value)}
                  placeholder="lat"
                />
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={lng}
                  onChange={(event) => setLng(event.target.value)}
                  placeholder="lng"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
                  onClick={handleUseMyLocation}
                  disabled={locationBusy}
                >
                  {locationBusy ? 'Locating...' : 'Use my location'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10"
                  onClick={clearCoordinates}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="text-sm">
              <p className="mb-1 text-[var(--muted)]">Amenities</p>
              <div className="flex flex-wrap gap-2">
                {AMENITY_OPTIONS.map((amenity) => (
                  <label
                    key={amenity}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={amenities.includes(amenity)}
                      onChange={() => toggleAmenity(amenity)}
                    />
                    {amenity}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {sort === 'nearest' &&
          (parseCoordinateInput(lat) == null || parseCoordinateInput(lng) == null) ? (
            <p className="text-xs text-[var(--muted)]">
              Add coordinates or use browser geolocation for accurate nearest ranking.
            </p>
          ) : null}
          {locationError ? (
            <p className="text-xs text-red-600 dark:text-red-300">{locationError}</p>
          ) : null}
        </section>

        {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}

        {featured.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-xl font-semibold">Featured Clubs</h2>
            <div className="grid gap-3 md:grid-cols-3">
              {featured.map((item) => (
                <article key={`featured-${item.clubId}`} className="panel-strong p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-base font-semibold">{item.name}</p>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                      {item.featuredBadge || 'Featured'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.city || 'City n/a'} · {item.area || 'Area n/a'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.openNow ? 'Open now' : 'Closed now'} · {formatDate(item.nextSlotAt)}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Link
                      href={`/clubs/${item.slug || item.clubId}`}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                      onClick={() => void sendEvent('club_opened', item.clubId, { source: 'featured' })}
                    >
                      Open
                    </Link>
                    <Link
                      href={`/bookings?clubId=${item.clubId}`}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                      onClick={() => void sendEvent('book_now_clicked', item.clubId, { source: 'featured' })}
                    >
                      Book now
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">All Clubs</h2>
            <p className="text-xs text-[var(--muted)]">{total} results</p>
          </div>

          {loading ? (
            <article className="panel-strong p-4 text-sm text-[var(--muted)]">Loading clubs...</article>
          ) : items.length < 1 ? (
            <article className="panel-strong p-4 text-sm text-[var(--muted)]">
              No clubs found for current filters. Try removing some filters.
            </article>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((item) => (
                <article key={item.clubId} className="panel-strong p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-lg font-semibold">{item.name}</p>
                    {item.isFeatured ? (
                      <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                        {item.featuredBadge || 'Featured'}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {item.city || 'City n/a'} · {item.area || 'Area n/a'}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.openNow ? 'Open now' : 'Closed now'} · Next: {formatDate(item.nextSlotAt)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.startingFrom
                      ? `From ${item.startingFrom.amount} ${item.startingFrom.currency}`
                      : 'Price hint unavailable'}
                    {item.distanceKm != null ? ` · ${formatDistance(item.distanceKm)}` : ''}
                    {' · '}
                    Seats {item.seatCount}
                  </p>
                  {item.amenities.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.amenities.slice(0, 6).map((amenity) => (
                        <span
                          key={`${item.clubId}-${amenity}`}
                          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px]"
                        >
                          {amenity}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/clubs/${item.slug || item.clubId}`}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm hover:bg-white/10"
                      onClick={() => void sendEvent('club_opened', item.clubId, { source: 'listing' })}
                    >
                      Open club
                    </Link>
                    <Link
                      href={`/bookings?clubId=${item.clubId}`}
                      className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm hover:bg-white/10"
                      onClick={() => void sendEvent('book_now_clicked', item.clubId, { source: 'listing' })}
                    >
                      Book now
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {nextCursor ? (
          <div>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  )
}
