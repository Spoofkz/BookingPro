type CacheEntry<T> = {
  value: T
  expiresAtMs: number
}

const floorAvailabilityCache = new Map<string, CacheEntry<unknown>>()
const DEFAULT_AVAILABILITY_CACHE_TTL_MS = 5_000

export function floorAvailabilityCacheKey(params: {
  clubId: string
  slotId: string
  floorId: string
  includeStaffDetails: boolean
}) {
  return [
    params.clubId,
    params.slotId,
    params.floorId,
    params.includeStaffDetails ? 'staff' : 'public',
  ].join(':')
}

export function readFloorAvailabilityCache<T>(key: string): T | null {
  const entry = floorAvailabilityCache.get(key)
  if (!entry) return null
  if (Date.now() >= entry.expiresAtMs) {
    floorAvailabilityCache.delete(key)
    return null
  }
  return entry.value as T
}

export function writeFloorAvailabilityCache<T>(
  key: string,
  value: T,
  ttlMs = DEFAULT_AVAILABILITY_CACHE_TTL_MS,
) {
  floorAvailabilityCache.set(key, {
    value,
    expiresAtMs: Date.now() + ttlMs,
  })
}

export function invalidateAvailabilityCacheForClubSlot(clubId: string, slotId: string) {
  const prefix = `${clubId}:${slotId}:`
  for (const key of floorAvailabilityCache.keys()) {
    if (key.startsWith(prefix)) {
      floorAvailabilityCache.delete(key)
    }
  }
}

export function invalidateAvailabilityCacheForClub(clubId: string) {
  const prefix = `${clubId}:`
  for (const key of floorAvailabilityCache.keys()) {
    if (key.startsWith(prefix)) {
      floorAvailabilityCache.delete(key)
    }
  }
}

