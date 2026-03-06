import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'

export type DiscoverySort =
  | 'recommended'
  | 'nearest'
  | 'price_asc'
  | 'soonest'
  | 'capacity'

export type DiscoveryQuery = {
  q?: string
  city?: string
  area?: string
  openNow?: boolean
  date?: string
  timeFromMinute?: number
  timeToMinute?: number
  amenities?: string[]
  priceMin?: number
  priceMax?: number
  sort?: DiscoverySort
  lat?: number
  lng?: number
  pageSize?: number
  cursor?: string
}

type DiscoveryRow = {
  clubId: string
  slug: string
  name: string
  coverImageUrl: string | null
  area: string | null
  city: string | null
  startingFromAmount: number | null
  currency: string
  startingFromSegment: string | null
  amenities: string[]
  openNow: boolean
  nextSlotAt: string | null
  isFeatured: boolean
  featuredRank: number | null
  featuredBadge: string | null
  seatCount: number
  distanceKm: number | null
  completenessScore: number
}

export type DiscoveryResult = {
  items: DiscoveryRow[]
  featured: DiscoveryRow[]
  total: number
  nextCursor: string | null
}

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const MAX_CANDIDATES = 400

const timePartFormatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterForTimeZone(timeZone: string) {
  const existing = timePartFormatterCache.get(timeZone)
  if (existing) return existing
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
  timePartFormatterCache.set(timeZone, formatter)
  return formatter
}

function minuteOfDayInTimeZone(date: Date, timeZone: string) {
  const parts = formatterForTimeZone(timeZone).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0
  return hour * 60 + minute
}

function sanitizeText(value: string | null | undefined) {
  return value?.trim() || ''
}

function parseStringArrayJson(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function normalizeAmenities(items: string[]) {
  return Array.from(
    new Set(
      items
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
}

function parseAddressArea(address: string | null | undefined) {
  const value = sanitizeText(address)
  if (!value) return null
  const [firstPart] = value.split(',')
  const area = firstPart?.trim()
  return area || null
}

function decodeCursor(cursor?: string) {
  if (!cursor) return 0
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = Number(decoded)
    if (!Number.isInteger(parsed) || parsed < 0) return 0
    return parsed
  } catch {
    return 0
  }
}

function encodeCursor(offset: number) {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

function parsePageSize(value: number | undefined) {
  if (!value || !Number.isInteger(value)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(1, value))
}

function parseTimeRange(timeFromMinute?: number, timeToMinute?: number) {
  if (timeFromMinute == null && timeToMinute == null) return null
  if (timeFromMinute == null || timeToMinute == null) return null
  if (timeFromMinute < 0 || timeFromMinute >= 1440) return null
  if (timeToMinute < 0 || timeToMinute >= 1440) return null
  return { timeFromMinute, timeToMinute }
}

function minuteMatchesRange(minute: number, start: number, end: number) {
  if (start === end) return true
  if (start < end) {
    return minute >= start && minute < end
  }
  return minute >= start || minute < end
}

function safeNumber(value: string | undefined) {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

function coordinateParam(value: string | undefined, min: number, max: number) {
  const parsed = safeNumber(value)
  if (parsed == null) return undefined
  if (parsed < min || parsed > max) return undefined
  return parsed
}

function parseAmenitiesParam(value: string | undefined) {
  if (!value) return []
  return normalizeAmenities(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function boolParam(value: string | undefined) {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function dateParam(value: string | undefined) {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  return value
}

function timeMinuteParam(value: string | undefined) {
  if (!value) return undefined
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

function compareNullableNumberAsc(left: number | null, right: number | null) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return left - right
}

function compareNullableDateAsc(left: string | null, right: string | null) {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return new Date(left).getTime() - new Date(right).getTime()
}

function rankRecommended(left: DiscoveryRow, right: DiscoveryRow) {
  const featuredLeft = left.isFeatured ? 1 : 0
  const featuredRight = right.isFeatured ? 1 : 0
  if (featuredLeft !== featuredRight) return featuredRight - featuredLeft

  if (left.isFeatured && right.isFeatured) {
    const byRank = compareNullableNumberAsc(left.featuredRank, right.featuredRank)
    if (byRank !== 0) return byRank
  }

  if (left.completenessScore !== right.completenessScore) {
    return right.completenessScore - left.completenessScore
  }

  const bySoonest = compareNullableDateAsc(left.nextSlotAt, right.nextSlotAt)
  if (bySoonest !== 0) return bySoonest

  const byPrice = compareNullableNumberAsc(left.startingFromAmount, right.startingFromAmount)
  if (byPrice !== 0) return byPrice

  return left.name.localeCompare(right.name)
}

function applySort(items: DiscoveryRow[], sort: DiscoverySort) {
  const sorted = [...items]
  if (sort === 'price_asc') {
    sorted.sort((left, right) => {
      const byPrice = compareNullableNumberAsc(left.startingFromAmount, right.startingFromAmount)
      if (byPrice !== 0) return byPrice
      return left.name.localeCompare(right.name)
    })
    return sorted
  }

  if (sort === 'soonest') {
    sorted.sort((left, right) => {
      const bySoonest = compareNullableDateAsc(left.nextSlotAt, right.nextSlotAt)
      if (bySoonest !== 0) return bySoonest
      return left.name.localeCompare(right.name)
    })
    return sorted
  }

  if (sort === 'capacity') {
    sorted.sort((left, right) => {
      if (left.seatCount !== right.seatCount) return right.seatCount - left.seatCount
      return left.name.localeCompare(right.name)
    })
    return sorted
  }

  if (sort === 'nearest') {
    if (!sorted.some((item) => item.distanceKm != null)) {
      sorted.sort(rankRecommended)
      return sorted
    }
    sorted.sort((left, right) => {
      const byDistance = compareNullableNumberAsc(left.distanceKm, right.distanceKm)
      if (byDistance !== 0) return byDistance
      return left.name.localeCompare(right.name)
    })
    return sorted
  }

  sorted.sort(rankRecommended)
  return sorted
}

export function parseDiscoveryQueryFromSearchParams(
  searchParams: URLSearchParams,
): DiscoveryQuery {
  return {
    q: sanitizeText(searchParams.get('q') ?? undefined) || undefined,
    city: sanitizeText(searchParams.get('city') ?? undefined) || undefined,
    area: sanitizeText(searchParams.get('area') ?? undefined) || undefined,
    openNow: boolParam(searchParams.get('openNow') ?? undefined),
    date: dateParam(searchParams.get('date') ?? undefined),
    timeFromMinute: timeMinuteParam(searchParams.get('timeFrom') ?? undefined),
    timeToMinute: timeMinuteParam(searchParams.get('timeTo') ?? undefined),
    amenities: parseAmenitiesParam(searchParams.get('amenities') ?? undefined),
    priceMin: safeNumber(searchParams.get('priceMin') ?? undefined),
    priceMax: safeNumber(searchParams.get('priceMax') ?? undefined),
    sort: (searchParams.get('sort') as DiscoverySort | null) ?? undefined,
    lat: coordinateParam(searchParams.get('lat') ?? undefined, -90, 90),
    lng: coordinateParam(searchParams.get('lng') ?? undefined, -180, 180),
    pageSize: safeNumber(searchParams.get('pageSize') ?? undefined),
    cursor: searchParams.get('cursor') ?? undefined,
  }
}

export async function searchPublicClubs(query: DiscoveryQuery): Promise<DiscoveryResult> {
  const now = new Date()
  const pageSize = parsePageSize(query.pageSize)
  const offset = decodeCursor(query.cursor)
  const sort: DiscoverySort = query.sort ?? 'recommended'
  const normalizedAmenities = normalizeAmenities(query.amenities ?? [])

  const whereAnd: Record<string, unknown>[] = [{ status: CLUB_STATUSES.PUBLISHED }]
  if (query.q) {
    whereAnd.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { address: { contains: query.q, mode: 'insensitive' } },
        { city: { contains: query.q, mode: 'insensitive' } },
        { area: { contains: query.q, mode: 'insensitive' } },
      ],
    })
  }
  if (query.city) {
    whereAnd.push({
      OR: [
        { city: { contains: query.city, mode: 'insensitive' } },
        { address: { contains: query.city, mode: 'insensitive' } },
      ],
    })
  }
  if (query.area) {
    whereAnd.push({
      OR: [
        { area: { contains: query.area, mode: 'insensitive' } },
        { address: { contains: query.area, mode: 'insensitive' } },
      ],
    })
  }

  const clubs = await prisma.club.findMany({
    where: { AND: whereAnd },
    orderBy: [{ publishedAt: 'desc' }, { name: 'asc' }],
    take: MAX_CANDIDATES,
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      address: true,
      city: true,
      area: true,
      timezone: true,
      currency: true,
      logoUrl: true,
      galleryJson: true,
      amenitiesJson: true,
      geoLat: true,
      geoLng: true,
      startingFromAmount: true,
      startingFromSegment: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
      businessHoursText: true,
    },
  })

  if (clubs.length < 1) {
    return {
      items: [],
      featured: [],
      total: 0,
      nextCursor: null,
    }
  }

  const clubIds = clubs.map((club) => club.id)
  const features = await prisma.clubFeatured.findMany({
    where: {
      clubId: { in: clubIds },
      isActive: true,
      featuredStartAt: { lte: now },
      featuredEndAt: { gt: now },
    },
    orderBy: [{ featuredRank: 'asc' }, { createdAt: 'desc' }],
    select: {
      clubId: true,
      featuredRank: true,
      badgeText: true,
    },
  })
  const featureByClubId = new Map<string, { rank: number; badgeText: string | null }>()
  for (const feature of features) {
    if (!featureByClubId.has(feature.clubId)) {
      featureByClubId.set(feature.clubId, {
        rank: feature.featuredRank,
        badgeText: feature.badgeText || null,
      })
    }
  }

  const mapVersions = await prisma.seatMapVersion.findMany({
    where: {
      clubId: { in: clubIds },
    },
    select: {
      clubId: true,
      versionNumber: true,
      seatCount: true,
    },
    orderBy: [{ clubId: 'asc' }, { versionNumber: 'desc' }],
  })
  const latestSeatCountByClubId = new Map<string, number>()
  for (const version of mapVersions) {
    if (!latestSeatCountByClubId.has(version.clubId)) {
      latestSeatCountByClubId.set(version.clubId, version.seatCount)
    }
  }

  const openNowRows = await prisma.slot.findMany({
    where: {
      clubId: { in: clubIds },
      status: 'PUBLISHED',
      startAtUtc: { lte: now },
      endAtUtc: { gt: now },
    },
    select: { clubId: true },
  })
  const openNowSet = new Set(openNowRows.map((row) => row.clubId))

  const lookaheadLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const upcomingSlots = await prisma.slot.findMany({
    where: {
      clubId: { in: clubIds },
      status: 'PUBLISHED',
      startAtUtc: { gte: now, lt: lookaheadLimit },
    },
    orderBy: [{ startAtUtc: 'asc' }],
    select: {
      clubId: true,
      startAtUtc: true,
      endAtUtc: true,
      localDate: true,
    },
  })
  const nextSlotByClubId = new Map<string, Date>()
  for (const slot of upcomingSlots) {
    if (!nextSlotByClubId.has(slot.clubId)) {
      nextSlotByClubId.set(slot.clubId, slot.startAtUtc)
    }
  }

  const dateRange = parseTimeRange(query.timeFromMinute, query.timeToMinute)
  let dateFilteredClubIds: Set<string> | null = null
  if (query.date) {
    const dateSlots = await prisma.slot.findMany({
      where: {
        clubId: { in: clubIds },
        status: 'PUBLISHED',
        localDate: query.date,
      },
      select: {
        clubId: true,
        startAtUtc: true,
      },
    })

    dateFilteredClubIds = new Set<string>()
    for (const slot of dateSlots) {
      const club = clubs.find((item) => item.id === slot.clubId)
      if (!club) continue
      if (dateRange) {
        const minute = minuteOfDayInTimeZone(slot.startAtUtc, club.timezone)
        if (!minuteMatchesRange(minute, dateRange.timeFromMinute, dateRange.timeToMinute)) {
          continue
        }
      }
      if ((latestSeatCountByClubId.get(slot.clubId) ?? 0) < 1) {
        continue
      }
      dateFilteredClubIds.add(slot.clubId)
    }
  }

  const rows: DiscoveryRow[] = clubs.map((club) => {
    const gallery = parseStringArrayJson(club.galleryJson)
    const amenities = normalizeAmenities(parseStringArrayJson(club.amenitiesJson))
    const feature = featureByClubId.get(club.id)
    const seatCount = latestSeatCountByClubId.get(club.id) ?? 0
    const nextSlotAt = nextSlotByClubId.get(club.id) ?? null
    const distanceKm =
      query.lat != null &&
      query.lng != null &&
      typeof club.geoLat === 'number' &&
      typeof club.geoLng === 'number'
        ? haversineDistanceKm(query.lat, query.lng, club.geoLat, club.geoLng)
        : null

    let completenessScore = 0
    if (sanitizeText(club.description)) completenessScore += 1
    if (sanitizeText(club.address)) completenessScore += 1
    if (club.logoUrl || gallery.length > 0) completenessScore += 1
    if (amenities.length > 0) completenessScore += 1
    if (club.startingFromAmount != null) completenessScore += 1
    if (nextSlotAt) completenessScore += 1

    return {
      clubId: club.id,
      slug: club.slug,
      name: club.name,
      coverImageUrl: club.logoUrl || gallery[0] || null,
      area: club.area || parseAddressArea(club.address),
      city: club.city || null,
      startingFromAmount: club.startingFromAmount,
      currency: club.currency,
      startingFromSegment: club.startingFromSegment,
      amenities,
      openNow: openNowSet.has(club.id),
      nextSlotAt: nextSlotAt ? nextSlotAt.toISOString() : null,
      isFeatured: Boolean(feature),
      featuredRank: feature?.rank ?? null,
      featuredBadge: feature?.badgeText ?? null,
      seatCount,
      distanceKm,
      completenessScore,
    }
  })

  let filtered = rows
  if (query.openNow !== undefined) {
    filtered = filtered.filter((item) => item.openNow === query.openNow)
  }
  if (dateFilteredClubIds) {
    filtered = filtered.filter((item) => dateFilteredClubIds.has(item.clubId))
  }
  if (normalizedAmenities.length > 0) {
    filtered = filtered.filter((item) =>
      normalizedAmenities.every((amenity) => item.amenities.includes(amenity)),
    )
  }
  if (query.priceMin != null) {
    filtered = filtered.filter(
      (item) => item.startingFromAmount != null && item.startingFromAmount >= query.priceMin!,
    )
  }
  if (query.priceMax != null) {
    filtered = filtered.filter(
      (item) => item.startingFromAmount != null && item.startingFromAmount <= query.priceMax!,
    )
  }

  const sorted = applySort(filtered, sort)
  const total = sorted.length
  const page = sorted.slice(offset, offset + pageSize)
  const nextCursor =
    offset + pageSize < total ? encodeCursor(offset + pageSize) : null

  const featured = sorted
    .filter((item) => item.isFeatured)
    .sort((left, right) => compareNullableNumberAsc(left.featuredRank, right.featuredRank))
    .slice(0, 12)

  return {
    items: page,
    featured,
    total,
    nextCursor,
  }
}
