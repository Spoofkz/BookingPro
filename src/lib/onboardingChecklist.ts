import { PricingRuleType, PricingScopeType, Role, SlotStatus } from '@prisma/client'
import { CLUB_STATUSES, normalizeClubStatus, type ClubStatus } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'

export const ONBOARDING_SLOT_HORIZON_DAYS = 7

export const ONBOARDING_KEYS = {
  PROFILE_COMPLETE: 'PROFILE_COMPLETE',
  MAP_PUBLISHED: 'MAP_PUBLISHED',
  PRICING_PUBLISHED: 'PRICING_PUBLISHED',
  SCHEDULE_READY: 'SCHEDULE_READY',
  POLICIES_SET: 'POLICIES_SET',
  STAFF_ASSIGNED: 'STAFF_ASSIGNED',
  ADDRESS_AND_GEO: 'ADDRESS_AND_GEO',
  BRANDING_ASSETS: 'BRANDING_ASSETS',
} as const

export type OnboardingKey = (typeof ONBOARDING_KEYS)[keyof typeof ONBOARDING_KEYS]
export type OnboardingItemStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED'

export type OnboardingItem = {
  key: OnboardingKey
  status: OnboardingItemStatus
  missing: string[]
  fixLink: string
  critical: boolean
}

export type OnboardingReport = {
  clubId: string
  status: ClubStatus
  progress: {
    completed: number
    total: number
  }
  items: OnboardingItem[]
  canPublish: boolean
  publishBlockers: OnboardingKey[]
  publishBlockerDetails: Record<OnboardingKey, string[]>
}

type ClubRecord = {
  id: string
  status: string
  name: string
  timezone: string
  currency: string
  address: string | null
  geoLat: number | null
  geoLng: number | null
  description: string | null
  logoUrl: string | null
  galleryJson: string | null
  contactsJson: string | null
  holdTtlMinutes: number | null
  cancellationPolicyJson: string | null
  checkInPolicyJson: string | null
  schedulePublishedAt: Date | null
  slotsGeneratedUntil: Date | null
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseContactsJson(input: string | null) {
  if (!input) return null
  try {
    const parsed = JSON.parse(input) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function hasContactMethod(contacts: Record<string, unknown> | null) {
  if (!contacts) return false
  const phone = typeof contacts.phone === 'string' ? contacts.phone.trim() : ''
  const whatsapp = typeof contacts.whatsapp === 'string' ? contacts.whatsapp.trim() : ''
  const email = typeof contacts.email === 'string' ? contacts.email.trim() : ''
  return Boolean(phone || whatsapp || email)
}

function deriveItemStatus(params: {
  missing: string[]
  started: boolean
  blocked?: boolean
}): OnboardingItemStatus {
  if (params.missing.length === 0) return 'COMPLETE'
  if (params.blocked) return 'BLOCKED'
  if (params.started) return 'IN_PROGRESS'
  return 'NOT_STARTED'
}

function makeItem(params: {
  key: OnboardingKey
  missing: string[]
  fixLink: string
  critical?: boolean
  started: boolean
  blocked?: boolean
}): OnboardingItem {
  return {
    key: params.key,
    missing: params.missing,
    fixLink: params.fixLink,
    critical: params.critical ?? true,
    status: deriveItemStatus({
      missing: params.missing,
      started: params.started,
      blocked: params.blocked,
    }),
  }
}

function effectiveClubStatus(currentStatus: ClubStatus, canPublish: boolean): ClubStatus {
  if (
    canPublish &&
    (currentStatus === CLUB_STATUSES.DRAFT || currentStatus === CLUB_STATUSES.READY_TO_PUBLISH)
  ) {
    return CLUB_STATUSES.READY_TO_PUBLISH
  }
  return currentStatus
}

export async function loadClubOnboardingReport(clubId: string): Promise<OnboardingReport> {
  const club = (await prisma.club.findUnique({
    where: { id: clubId },
    select: {
      id: true,
      status: true,
      name: true,
      timezone: true,
      currency: true,
      address: true,
      geoLat: true,
      geoLng: true,
      description: true,
      logoUrl: true,
      galleryJson: true,
      contactsJson: true,
      holdTtlMinutes: true,
      cancellationPolicyJson: true,
      checkInPolicyJson: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
    },
  })) as ClubRecord | null

  if (!club) {
    throw new Error('Club not found.')
  }

  const contacts = parseContactsJson(club.contactsJson)

  const profileMissing: string[] = []
  if (!club.name?.trim()) profileMissing.push('Club name is required.')
  if (!club.timezone?.trim()) profileMissing.push('Timezone is required.')
  if (!club.currency?.trim()) profileMissing.push('Currency is required.')
  if (!hasContactMethod(contacts)) {
    profileMissing.push('At least one contact method is required (phone/whatsapp/email).')
  }

  const seatMap = await prisma.seatMap.findUnique({
    where: { clubId: club.id },
    select: { id: true },
  })

  const latestMapVersion = seatMap
    ? await prisma.seatMapVersion.findFirst({
        where: { mapId: seatMap.id },
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          seatCount: true,
          versionNumber: true,
        },
      })
    : null

  const mapMissing: string[] = []
  if (!latestMapVersion) {
    mapMissing.push('No published map version.')
  }
  if (latestMapVersion && latestMapVersion.seatCount < 1) {
    mapMissing.push('Seat count is 0 in latest published map.')
  }

  const seatSegments = latestMapVersion
    ? await prisma.seatIndex.findMany({
        where: {
          mapVersionId: latestMapVersion.id,
          isActive: true,
          isDisabled: false,
        },
        select: { segmentId: true },
      })
    : []
  const seatSegmentIds = Array.from(
    new Set(seatSegments.map((seatSegment) => seatSegment.segmentId).filter(Boolean)),
  )

  const activePublishedPricing = await prisma.pricingVersion.findFirst({
    where: {
      clubId: club.id,
      status: 'PUBLISHED',
      effectiveFrom: { lte: new Date() },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { versionNumber: 'desc' }],
    select: {
      id: true,
      rules: {
        select: {
          ruleType: true,
          scopeType: true,
          scopeId: true,
          setRatePerHourCents: true,
        },
      },
    },
  })

  const pricingMissing: string[] = []
  if (!activePublishedPricing) {
    pricingMissing.push('No active published pricing version effective now.')
  }

  if (activePublishedPricing && seatSegmentIds.length > 0) {
    const baseRateSegmentIds = new Set(
      activePublishedPricing.rules
        .filter(
          (rule) =>
            rule.ruleType === PricingRuleType.BASE_RATE &&
            rule.scopeType === PricingScopeType.SEGMENT &&
            rule.setRatePerHourCents != null &&
            rule.setRatePerHourCents > 0,
        )
        .map((rule) => rule.scopeId),
    )

    const uncoveredSegmentIds = seatSegmentIds.filter((segmentId) => !baseRateSegmentIds.has(segmentId))
    if (uncoveredSegmentIds.length > 0) {
      const segments = await prisma.segment.findMany({
        where: { id: { in: uncoveredSegmentIds } },
        select: { id: true, name: true },
      })
      const segmentNameById = new Map(segments.map((segment) => [segment.id, segment.name]))
      for (const segmentId of uncoveredSegmentIds) {
        pricingMissing.push(
          `Missing BASE_RATE for segment "${segmentNameById.get(segmentId) ?? segmentId}".`,
        )
      }
    }
  }

  const scheduleMissing: string[] = []
  const now = new Date()
  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + ONBOARDING_SLOT_HORIZON_DAYS)

  const scheduleTemplate = await prisma.scheduleTemplate.findUnique({
    where: { clubId: club.id },
    select: { id: true, updatedAt: true },
  })

  if (!scheduleTemplate) {
    scheduleMissing.push('Schedule template is not configured.')
  }
  if (!club.schedulePublishedAt) {
    scheduleMissing.push('Schedule is not published yet.')
  }
  if (!club.slotsGeneratedUntil) {
    scheduleMissing.push(`Slots are not generated for next ${ONBOARDING_SLOT_HORIZON_DAYS} days.`)
  } else if (club.slotsGeneratedUntil < horizon) {
    scheduleMissing.push(
      `Slots are generated only until ${club.slotsGeneratedUntil.toISOString()} (need >= ${horizon.toISOString()}).`,
    )
  }

  const publishedSlotsInHorizon = await prisma.slot.count({
    where: {
      clubId: club.id,
      status: SlotStatus.PUBLISHED,
      startAtUtc: { gte: now, lt: horizon },
    },
  })
  if (publishedSlotsInHorizon < 1) {
    scheduleMissing.push(
      `No published slots found in the next ${ONBOARDING_SLOT_HORIZON_DAYS} days.`,
    )
  }

  const policyMissing: string[] = []
  if (!club.holdTtlMinutes || club.holdTtlMinutes < 1) {
    policyMissing.push('Hold TTL must be configured.')
  }
  if (!club.cancellationPolicyJson) {
    policyMissing.push('Cancellation policy is required.')
  }
  if (!club.checkInPolicyJson) {
    policyMissing.push('Check-in policy is required.')
  }

  const memberships = await prisma.clubMembership.findMany({
    where: { clubId: club.id, status: 'ACTIVE' },
    select: { role: true },
  })

  const hostCount = memberships.filter((membership) => membership.role === Role.HOST_ADMIN).length
  const techCount = memberships.filter((membership) => membership.role === Role.TECH_ADMIN).length
  const staffMissing: string[] = []

  if (hostCount < 1) {
    staffMissing.push('At least one HOST_ADMIN must be assigned.')
  }
  if (techCount < 1) {
    staffMissing.push('At least one TECH_ADMIN must be assigned.')
  }

  const profileRecommendedMissing: string[] = []
  if (!club.address?.trim()) {
    profileRecommendedMissing.push('Address is recommended before go-live.')
  }
  if (club.geoLat == null || club.geoLng == null) {
    profileRecommendedMissing.push('Geo coordinates are recommended before go-live.')
  }

  const brandingMissing: string[] = []
  if (!club.description?.trim()) {
    brandingMissing.push('Club description is recommended.')
  }
  let galleryUrls: string[] = []
  if (club.galleryJson) {
    try {
      const parsed = JSON.parse(club.galleryJson) as unknown
      if (Array.isArray(parsed)) {
        galleryUrls = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    } catch {
      galleryUrls = []
    }
  }
  if (!club.logoUrl?.trim() && galleryUrls.length === 0) {
    brandingMissing.push('Logo or at least one gallery image is recommended.')
  }

  const items: OnboardingItem[] = [
    makeItem({
      key: ONBOARDING_KEYS.PROFILE_COMPLETE,
      missing: profileMissing,
      fixLink: '/cabinet/tech/onboarding',
      started: Boolean(club.name || club.timezone || club.currency || contacts),
    }),
    makeItem({
      key: ONBOARDING_KEYS.MAP_PUBLISHED,
      missing: mapMissing,
      fixLink: '/cabinet/tech/map-editor',
      started: Boolean(seatMap || latestMapVersion),
    }),
    makeItem({
      key: ONBOARDING_KEYS.PRICING_PUBLISHED,
      missing: pricingMissing,
      fixLink: '/cabinet/tech/pricing',
      started: Boolean(activePublishedPricing),
      blocked: !latestMapVersion,
    }),
    makeItem({
      key: ONBOARDING_KEYS.SCHEDULE_READY,
      missing: scheduleMissing,
      fixLink: '/cabinet/tech/schedule',
      started: Boolean(scheduleTemplate || club.schedulePublishedAt || club.slotsGeneratedUntil),
    }),
    makeItem({
      key: ONBOARDING_KEYS.POLICIES_SET,
      missing: policyMissing,
      fixLink: '/cabinet/tech/policies',
      started: Boolean(club.holdTtlMinutes || club.cancellationPolicyJson || club.checkInPolicyJson),
    }),
    makeItem({
      key: ONBOARDING_KEYS.STAFF_ASSIGNED,
      missing: staffMissing,
      fixLink: '/cabinet/tech/staff',
      started: memberships.length > 0,
    }),
    makeItem({
      key: ONBOARDING_KEYS.ADDRESS_AND_GEO,
      missing: profileRecommendedMissing,
      fixLink: '/cabinet/tech/onboarding#address-geo',
      started: Boolean(club.address || club.geoLat != null || club.geoLng != null),
      critical: false,
    }),
    makeItem({
      key: ONBOARDING_KEYS.BRANDING_ASSETS,
      missing: brandingMissing,
      fixLink: '/cabinet/tech/onboarding#branding-assets',
      started: Boolean(club.description || club.logoUrl || galleryUrls.length > 0),
      critical: false,
    }),
  ]

  const completed = items.filter((item) => item.status === 'COMPLETE').length
  const total = items.length
  const publishBlockers = items
    .filter((item) => item.critical && item.status !== 'COMPLETE')
    .map((item) => item.key)
  const publishBlockerDetails = publishBlockers.reduce<Record<OnboardingKey, string[]>>(
    (accumulator, key) => {
      const item = items.find((candidate) => candidate.key === key)
      accumulator[key] = item?.missing ?? []
      return accumulator
    },
    {} as Record<OnboardingKey, string[]>,
  )
  const canPublish = publishBlockers.length === 0

  return {
    clubId: club.id,
    status: effectiveClubStatus(normalizeClubStatus(club.status), canPublish),
    progress: { completed, total },
    items,
    canPublish,
    publishBlockers,
    publishBlockerDetails,
  }
}
