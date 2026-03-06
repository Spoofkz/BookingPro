import {
  PricingPackagePricingType,
  PricingRule,
  PricingRuleType,
  PricingScopeType,
  type PricingVersion,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export type PricingPublishBlocker =
  | 'MAP_PUBLISHED'
  | 'SEGMENT_COVERAGE'
  | 'PACKAGE_CONFIGURATION'
  | 'TIME_MODIFIER_OVERLAP'
  | 'EFFECTIVE_WINDOW'
  | 'VERSION_OVERLAP'

export type PricingPublishValidationResult = {
  canPublish: boolean
  blockers: PricingPublishBlocker[]
  details: Record<PricingPublishBlocker, string[]>
  autoClosableVersionIds: string[]
}

type ValidatePricingPublishInput = {
  clubId: string
  pricingVersion: PricingVersion & { rules: PricingRule[] }
  effectiveFrom: Date
  effectiveTo: Date | null
  now?: Date
  allowPastEffectiveFrom?: boolean
}

type ExpandedInterval = {
  day: number
  startMinute: number
  endMinute: number
}

function initDetails(): Record<PricingPublishBlocker, string[]> {
  return {
    MAP_PUBLISHED: [],
    SEGMENT_COVERAGE: [],
    PACKAGE_CONFIGURATION: [],
    TIME_MODIFIER_OVERLAP: [],
    EFFECTIVE_WINDOW: [],
    VERSION_OVERLAP: [],
  }
}

function minutesInRange(value: number | null | undefined) {
  return value != null && Number.isInteger(value) && value >= 0 && value < 24 * 60
}

function parseDayCsv(csv: string | null) {
  if (!csv) return [0, 1, 2, 3, 4, 5, 6]
  const parsed = csv
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isInteger(part) && part >= 0 && part <= 6)
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [0, 1, 2, 3, 4, 5, 6]
}

function intervalsForRule(rule: PricingRule): ExpandedInterval[] {
  const days = parseDayCsv(rule.dayOfWeekCsv)
  const startRaw = rule.timeWindowStartMinute
  const endRaw = rule.timeWindowEndMinute
  const intervals: ExpandedInterval[] = []

  if (!minutesInRange(startRaw) || !minutesInRange(endRaw) || startRaw === endRaw) {
    for (const day of days) {
      intervals.push({ day, startMinute: 0, endMinute: 24 * 60 })
    }
    return intervals
  }
  const start = startRaw as number
  const end = endRaw as number

  if (start < end) {
    for (const day of days) {
      intervals.push({ day, startMinute: start, endMinute: end })
    }
    return intervals
  }

  for (const day of days) {
    intervals.push({ day, startMinute: start, endMinute: 24 * 60 })
    intervals.push({ day: (day + 1) % 7, startMinute: 0, endMinute: end })
  }

  return intervals
}

function overlapIntervals(a: ExpandedInterval, b: ExpandedInterval) {
  if (a.day !== b.day) return false
  return a.startMinute < b.endMinute && a.endMinute > b.startMinute
}

function overlapGroupKey(rule: PricingRule) {
  return [
    rule.scopeType,
    rule.scopeId,
    rule.priority,
    rule.channel ?? '*',
    rule.customerType ?? '*',
  ].join('|')
}

function addDetail(
  details: Record<PricingPublishBlocker, string[]>,
  blocker: PricingPublishBlocker,
  message: string,
) {
  const current = details[blocker]
  if (!current.includes(message)) {
    current.push(message)
  }
}

function hasAnyBlockingDetail(details: Record<PricingPublishBlocker, string[]>) {
  return Object.values(details).some((items) => items.length > 0)
}

export async function validatePricingVersionForPublish(
  input: ValidatePricingPublishInput,
): Promise<PricingPublishValidationResult> {
  const now = input.now ?? new Date()
  const details = initDetails()

  if (!input.allowPastEffectiveFrom && input.effectiveFrom < now) {
    addDetail(
      details,
      'EFFECTIVE_WINDOW',
      'effectiveFrom cannot be in the past at publish time.',
    )
  }
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    addDetail(
      details,
      'EFFECTIVE_WINDOW',
      'effectiveTo must be greater than effectiveFrom.',
    )
  }

  const map = await prisma.seatMap.findUnique({
    where: { clubId: input.clubId },
    select: { id: true },
  })

  let seatSegmentIds: string[] = []
  if (!map) {
    addDetail(details, 'MAP_PUBLISHED', 'No published map exists for this club.')
  } else {
    const latestVersion = await prisma.seatMapVersion.findFirst({
      where: { mapId: map.id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, seatCount: true },
    })

    if (!latestVersion) {
      addDetail(details, 'MAP_PUBLISHED', 'No published map version exists.')
    } else if (latestVersion.seatCount < 1) {
      addDetail(details, 'MAP_PUBLISHED', 'Latest published map has zero seats.')
    } else {
      const seatSegments = await prisma.seatIndex.findMany({
        where: {
          clubId: input.clubId,
          mapVersionId: latestVersion.id,
          isActive: true,
          isDisabled: false,
        },
        select: { segmentId: true },
      })
      seatSegmentIds = Array.from(
        new Set(seatSegments.map((seat) => seat.segmentId).filter(Boolean)),
      )
      if (seatSegmentIds.length < 1) {
        addDetail(details, 'MAP_PUBLISHED', 'Latest published map has no active bookable seats.')
      }
    }
  }

  if (seatSegmentIds.length > 0) {
    const coveredSegments = new Set(
      input.pricingVersion.rules
        .filter(
          (rule) =>
            rule.ruleType === PricingRuleType.BASE_RATE &&
            rule.scopeType === PricingScopeType.SEGMENT &&
            rule.setRatePerHourCents != null &&
            rule.setRatePerHourCents > 0,
        )
        .map((rule) => rule.scopeId),
    )

    const missingSegmentIds = seatSegmentIds.filter((segmentId) => !coveredSegments.has(segmentId))
    if (missingSegmentIds.length > 0) {
      const segments = await prisma.segment.findMany({
        where: { id: { in: missingSegmentIds } },
        select: { id: true, name: true },
      })
      const nameById = new Map(segments.map((segment) => [segment.id, segment.name]))
      for (const segmentId of missingSegmentIds) {
        addDetail(
          details,
          'SEGMENT_COVERAGE',
          `Missing BASE_RATE for segment "${nameById.get(segmentId) ?? segmentId}".`,
        )
      }
    }
  }

  const activePackages = await prisma.pricingPackage.findMany({
    where: { clubId: input.clubId, isActive: true },
    select: {
      id: true,
      name: true,
      durationMinutes: true,
      pricingType: true,
      fixedPriceCents: true,
      discountPercent: true,
      ratePerHourCents: true,
      timeWindowStartMinute: true,
      timeWindowEndMinute: true,
      daysOfWeekCsv: true,
    },
  })

  for (const pricingPackage of activePackages) {
    if (!Number.isInteger(pricingPackage.durationMinutes) || pricingPackage.durationMinutes <= 0) {
      addDetail(
        details,
        'PACKAGE_CONFIGURATION',
        `Package "${pricingPackage.name}" has invalid durationMinutes.`,
      )
    }

    if (pricingPackage.pricingType === PricingPackagePricingType.FIXED_PRICE) {
      if (
        !Number.isInteger(pricingPackage.fixedPriceCents) ||
        (pricingPackage.fixedPriceCents ?? -1) < 0
      ) {
        addDetail(
          details,
          'PACKAGE_CONFIGURATION',
          `Package "${pricingPackage.name}" requires fixedPriceCents.`,
        )
      }
    }

    if (pricingPackage.pricingType === PricingPackagePricingType.DISCOUNTED_HOURLY) {
      if (
        typeof pricingPackage.discountPercent !== 'number' ||
        pricingPackage.discountPercent < 0
      ) {
        addDetail(
          details,
          'PACKAGE_CONFIGURATION',
          `Package "${pricingPackage.name}" requires discountPercent.`,
        )
      }
    }

    if (pricingPackage.pricingType === PricingPackagePricingType.RATE_PER_HOUR) {
      if (
        !Number.isInteger(pricingPackage.ratePerHourCents) ||
        (pricingPackage.ratePerHourCents ?? -1) < 0
      ) {
        addDetail(
          details,
          'PACKAGE_CONFIGURATION',
          `Package "${pricingPackage.name}" requires ratePerHourCents.`,
        )
      }
    }

    const hasStart = pricingPackage.timeWindowStartMinute != null
    const hasEnd = pricingPackage.timeWindowEndMinute != null
    if (hasStart !== hasEnd) {
      addDetail(
        details,
        'PACKAGE_CONFIGURATION',
        `Package "${pricingPackage.name}" must set both timeWindowStartMinute and timeWindowEndMinute.`,
      )
    }
    if (
      hasStart &&
      hasEnd &&
      (!minutesInRange(pricingPackage.timeWindowStartMinute) ||
        !minutesInRange(pricingPackage.timeWindowEndMinute))
    ) {
      addDetail(
        details,
        'PACKAGE_CONFIGURATION',
        `Package "${pricingPackage.name}" has invalid time window minutes.`,
      )
    }

    const days = parseDayCsv(pricingPackage.daysOfWeekCsv)
    if (days.length < 1) {
      addDetail(
        details,
        'PACKAGE_CONFIGURATION',
        `Package "${pricingPackage.name}" has invalid daysOfWeekCsv.`,
      )
    }
  }

  const timeModifiers = input.pricingVersion.rules.filter(
    (rule) => rule.ruleType === PricingRuleType.TIME_MODIFIER,
  )
  const grouped = new Map<string, PricingRule[]>()
  for (const rule of timeModifiers) {
    const key = overlapGroupKey(rule)
    const existing = grouped.get(key) ?? []
    existing.push(rule)
    grouped.set(key, existing)
  }

  for (const [key, rules] of grouped) {
    if (rules.length < 2) continue
    for (let i = 0; i < rules.length; i += 1) {
      for (let j = i + 1; j < rules.length; j += 1) {
        const left = rules[i]
        const right = rules[j]
        const leftIntervals = intervalsForRule(left)
        const rightIntervals = intervalsForRule(right)
        const overlaps = leftIntervals.some((leftInterval) =>
          rightIntervals.some((rightInterval) => overlapIntervals(leftInterval, rightInterval)),
        )
        if (!overlaps) continue

        const leftLabel = left.label ?? left.id
        const rightLabel = right.label ?? right.id
        addDetail(
          details,
          'TIME_MODIFIER_OVERLAP',
          `Overlapping TIME_MODIFIER rules with equal priority: "${leftLabel}" and "${rightLabel}" (${key}).`,
        )
      }
    }
  }

  const overlapEnd = input.effectiveTo ?? new Date('9999-12-31T23:59:59.999Z')
  const overlappingPublished = await prisma.pricingVersion.findMany({
    where: {
      clubId: input.clubId,
      status: 'PUBLISHED',
      id: { not: input.pricingVersion.id },
      effectiveFrom: { lt: overlapEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.effectiveFrom } }],
    },
    select: {
      id: true,
      versionNumber: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })

  const autoClosableVersionIds: string[] = []
  for (const version of overlappingPublished) {
    if (!version.effectiveTo && version.effectiveFrom < input.effectiveFrom) {
      autoClosableVersionIds.push(version.id)
      continue
    }
    addDetail(
      details,
      'VERSION_OVERLAP',
      `Version ${version.versionNumber} overlaps with requested effective window.`,
    )
  }

  const blockers = Object.entries(details)
    .filter(([, blockerDetails]) => blockerDetails.length > 0)
    .map(([blocker]) => blocker as PricingPublishBlocker)

  return {
    canPublish: !hasAnyBlockingDetail(details),
    blockers,
    details,
    autoClosableVersionIds,
  }
}
