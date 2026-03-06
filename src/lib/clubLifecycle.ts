export const CLUB_STATUSES = {
  DRAFT: 'DRAFT',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  PUBLISHED: 'PUBLISHED',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const

export type ClubStatus = (typeof CLUB_STATUSES)[keyof typeof CLUB_STATUSES]
export type ClubTransitionAction = 'publish' | 'pause' | 'resume'

const KNOWN_STATUSES = new Set<ClubStatus>(Object.values(CLUB_STATUSES))

export function normalizeClubStatus(input: string | null | undefined): ClubStatus {
  if (!input) return CLUB_STATUSES.DRAFT
  const normalized = input.trim().toUpperCase()
  if (normalized === 'ACTIVE') return CLUB_STATUSES.PUBLISHED
  if (normalized === 'READY') return CLUB_STATUSES.READY_TO_PUBLISH
  if (KNOWN_STATUSES.has(normalized as ClubStatus)) {
    return normalized as ClubStatus
  }
  return CLUB_STATUSES.DRAFT
}

export function isPublishedClub(status: string | null | undefined) {
  return normalizeClubStatus(status) === CLUB_STATUSES.PUBLISHED
}

export function acceptsNewBookings(status: string | null | undefined) {
  return normalizeClubStatus(status) === CLUB_STATUSES.PUBLISHED
}

const TRANSITION_ALLOWED_FROM: Record<ClubTransitionAction, ClubStatus[]> = {
  publish: [CLUB_STATUSES.DRAFT, CLUB_STATUSES.READY_TO_PUBLISH],
  pause: [CLUB_STATUSES.DRAFT, CLUB_STATUSES.READY_TO_PUBLISH, CLUB_STATUSES.PUBLISHED],
  resume: [CLUB_STATUSES.PAUSED],
}

export function canTransitionClubStatus(fromStatus: ClubStatus, action: ClubTransitionAction) {
  return TRANSITION_ALLOWED_FROM[action].includes(fromStatus)
}

export function allowedTransitionFrom(action: ClubTransitionAction) {
  return [...TRANSITION_ALLOWED_FROM[action]]
}
