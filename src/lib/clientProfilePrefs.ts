import { prisma } from '@/src/lib/prisma'

const CLIENT_PROFILE_PREFS_ENTITY_TYPE = 'CLIENT_PROFILE_PREFS'

export type ClientProfilePrefs = {
  preferredLanguage: string
  marketingOptIn: boolean
  transactionalOptIn: boolean
  avatarUrl: string | null
  nickname: string | null
  birthday: string | null
  city: string | null
  preferredTimeWindow: string | null
  favoriteSegment: string | null
  seatPreference: string | null
  favoriteClubIds: string[]
}

export const DEFAULT_CLIENT_PROFILE_PREFS: ClientProfilePrefs = {
  preferredLanguage: 'en',
  marketingOptIn: false,
  transactionalOptIn: true,
  avatarUrl: null,
  nickname: null,
  birthday: null,
  city: null,
  preferredTimeWindow: null,
  favoriteSegment: null,
  seatPreference: null,
  favoriteClubIds: [],
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_CLIENT_PROFILE_PREFS.preferredLanguage
  const normalized = value.trim().toLowerCase()
  if (!normalized) return DEFAULT_CLIENT_PROFILE_PREFS.preferredLanguage
  return normalized.slice(0, 10)
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (value === true) return true
  if (value === false) return false
  return fallback
}

function normalizeNullableString(value: unknown, maxLength: number) {
  if (value === null) return null
  if (value === undefined) return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function normalizeBirthday(value: unknown) {
  const normalized = normalizeNullableString(value, 32)
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  return normalized
}

function normalizeClubIds(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_CLIENT_PROFILE_PREFS.favoriteClubIds
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30)
  return Array.from(new Set(cleaned))
}

export function parseClientProfilePrefs(raw: string | null | undefined): ClientProfilePrefs {
  if (!raw) return DEFAULT_CLIENT_PROFILE_PREFS
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      preferredLanguage: normalizeLanguage(parsed.preferredLanguage),
      marketingOptIn: normalizeBoolean(
        parsed.marketingOptIn,
        DEFAULT_CLIENT_PROFILE_PREFS.marketingOptIn,
      ),
      transactionalOptIn: normalizeBoolean(
        parsed.transactionalOptIn,
        DEFAULT_CLIENT_PROFILE_PREFS.transactionalOptIn,
      ),
      avatarUrl: normalizeNullableString(parsed.avatarUrl, 500),
      nickname: normalizeNullableString(parsed.nickname, 120),
      birthday: normalizeBirthday(parsed.birthday),
      city: normalizeNullableString(parsed.city, 120),
      preferredTimeWindow: normalizeNullableString(parsed.preferredTimeWindow, 80),
      favoriteSegment: normalizeNullableString(parsed.favoriteSegment, 80),
      seatPreference: normalizeNullableString(parsed.seatPreference, 120),
      favoriteClubIds: normalizeClubIds(parsed.favoriteClubIds),
    }
  } catch {
    return DEFAULT_CLIENT_PROFILE_PREFS
  }
}

export async function getClientProfilePrefs(userId: string): Promise<ClientProfilePrefs> {
  const latest = await prisma.platformNote.findFirst({
    where: {
      entityType: CLIENT_PROFILE_PREFS_ENTITY_TYPE,
      entityId: userId,
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      text: true,
    },
  })

  return parseClientProfilePrefs(latest?.text)
}

export async function upsertClientProfilePrefs(params: {
  userId: string
  actorUserId: string
  clubId?: string | null
  preferredLanguage?: unknown
  marketingOptIn?: unknown
  transactionalOptIn?: unknown
  avatarUrl?: unknown
  nickname?: unknown
  birthday?: unknown
  city?: unknown
  preferredTimeWindow?: unknown
  favoriteSegment?: unknown
  seatPreference?: unknown
  favoriteClubIds?: unknown
}) {
  const current = await getClientProfilePrefs(params.userId)
  const next: ClientProfilePrefs = {
    preferredLanguage:
      params.preferredLanguage === undefined
        ? current.preferredLanguage
        : normalizeLanguage(params.preferredLanguage),
    marketingOptIn:
      params.marketingOptIn === undefined
        ? current.marketingOptIn
        : normalizeBoolean(params.marketingOptIn, current.marketingOptIn),
    transactionalOptIn:
      params.transactionalOptIn === undefined
        ? current.transactionalOptIn
        : normalizeBoolean(params.transactionalOptIn, current.transactionalOptIn),
    avatarUrl:
      params.avatarUrl === undefined
        ? current.avatarUrl
        : normalizeNullableString(params.avatarUrl, 500),
    nickname:
      params.nickname === undefined
        ? current.nickname
        : normalizeNullableString(params.nickname, 120),
    birthday:
      params.birthday === undefined
        ? current.birthday
        : normalizeBirthday(params.birthday),
    city:
      params.city === undefined
        ? current.city
        : normalizeNullableString(params.city, 120),
    preferredTimeWindow:
      params.preferredTimeWindow === undefined
        ? current.preferredTimeWindow
        : normalizeNullableString(params.preferredTimeWindow, 80),
    favoriteSegment:
      params.favoriteSegment === undefined
        ? current.favoriteSegment
        : normalizeNullableString(params.favoriteSegment, 80),
    seatPreference:
      params.seatPreference === undefined
        ? current.seatPreference
        : normalizeNullableString(params.seatPreference, 120),
    favoriteClubIds:
      params.favoriteClubIds === undefined
        ? current.favoriteClubIds
        : normalizeClubIds(params.favoriteClubIds),
  }

  const existing = await prisma.platformNote.findFirst({
    where: {
      entityType: CLIENT_PROFILE_PREFS_ENTITY_TYPE,
      entityId: params.userId,
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
    },
  })

  if (existing) {
    await prisma.platformNote.update({
      where: { id: existing.id },
      data: {
        text: JSON.stringify(next),
      },
    })
  } else {
    await prisma.platformNote.create({
      data: {
        entityType: CLIENT_PROFILE_PREFS_ENTITY_TYPE,
        entityId: params.userId,
        clubId: params.clubId || null,
        text: JSON.stringify(next),
        createdByUserId: params.actorUserId,
      },
    })
  }

  return next
}
