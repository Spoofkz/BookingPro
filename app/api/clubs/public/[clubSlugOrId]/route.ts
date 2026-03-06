import { NextRequest, NextResponse } from 'next/server'
import { CLUB_STATUSES } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubSlugOrId: string }>
}

function parseContacts(input: string | null) {
  if (!input) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseStringArrayJson(input: string | null) {
  if (!input) return []
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function addDays(date: Date, days: number) {
  const value = new Date(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubSlugOrId } = await routeContext.params
  const now = new Date()
  const weekAhead = addDays(now, 7)

  const club = await prisma.club.findFirst({
    where: {
      status: CLUB_STATUSES.PUBLISHED,
      OR: [{ id: clubSlugOrId }, { slug: clubSlugOrId }],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      area: true,
      address: true,
      description: true,
      contactsJson: true,
      timezone: true,
      currency: true,
      logoUrl: true,
      galleryJson: true,
      amenitiesJson: true,
      geoLat: true,
      geoLng: true,
      businessHoursText: true,
      startingFromAmount: true,
      startingFromSegment: true,
      schedulePublishedAt: true,
      slotsGeneratedUntil: true,
    },
  })

  if (!club) {
    return NextResponse.json({ error: 'Club not found.' }, { status: 404 })
  }

  const [feature, openNowSlot, nextSlot, schedulePreviewSlots, latestMapVersion, packageHighlights] =
    await Promise.all([
      prisma.clubFeatured.findFirst({
        where: {
          clubId: club.id,
          isActive: true,
          featuredStartAt: { lte: now },
          featuredEndAt: { gt: now },
        },
        orderBy: [{ featuredRank: 'asc' }, { createdAt: 'desc' }],
        select: {
          featuredRank: true,
          badgeText: true,
        },
      }),
      prisma.slot.findFirst({
        where: {
          clubId: club.id,
          status: 'PUBLISHED',
          startAtUtc: { lte: now },
          endAtUtc: { gt: now },
        },
        select: { id: true },
      }),
      prisma.slot.findFirst({
        where: {
          clubId: club.id,
          status: 'PUBLISHED',
          startAtUtc: { gte: now },
        },
        orderBy: { startAtUtc: 'asc' },
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          localDate: true,
        },
      }),
      prisma.slot.findMany({
        where: {
          clubId: club.id,
          status: 'PUBLISHED',
          startAtUtc: { gte: now, lt: weekAhead },
        },
        orderBy: { startAtUtc: 'asc' },
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          localDate: true,
        },
        take: 200,
      }),
      prisma.seatMapVersion.findFirst({
        where: { clubId: club.id },
        orderBy: { versionNumber: 'desc' },
        select: {
          versionNumber: true,
          seatCount: true,
          publishedAt: true,
        },
      }),
      prisma.pricingPackage.findMany({
        where: {
          clubId: club.id,
          isActive: true,
          visibleToClients: true,
        },
        orderBy: [{ durationMinutes: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          pricingType: true,
        },
        take: 6,
      }),
    ])

  const scheduleByDate = new Map<
    string,
    {
      localDate: string
      slotCount: number
      firstStartAt: Date
      lastEndAt: Date
    }
  >()
  for (const slot of schedulePreviewSlots) {
    const existing = scheduleByDate.get(slot.localDate)
    if (!existing) {
      scheduleByDate.set(slot.localDate, {
        localDate: slot.localDate,
        slotCount: 1,
        firstStartAt: slot.startAtUtc,
        lastEndAt: slot.endAtUtc,
      })
      continue
    }
    existing.slotCount += 1
    if (slot.startAtUtc < existing.firstStartAt) existing.firstStartAt = slot.startAtUtc
    if (slot.endAtUtc > existing.lastEndAt) existing.lastEndAt = slot.endAtUtc
  }

  return NextResponse.json({
    clubId: club.id,
    slug: club.slug,
    name: club.name,
    description: club.description,
    city: club.city,
    area: club.area,
    address: club.address,
    timezone: club.timezone,
    currency: club.currency,
    contacts: parseContacts(club.contactsJson),
    logoUrl: club.logoUrl,
    galleryUrls: parseStringArrayJson(club.galleryJson),
    amenities: parseStringArrayJson(club.amenitiesJson),
    geo: {
      lat: club.geoLat,
      lng: club.geoLng,
    },
    businessHoursText: club.businessHoursText,
    startingFrom:
      club.startingFromAmount == null
        ? null
        : {
            amount: club.startingFromAmount,
            currency: club.currency,
            segment: club.startingFromSegment,
          },
    featured: feature
      ? {
          rank: feature.featuredRank,
          badgeText: feature.badgeText,
        }
      : null,
    openNow: Boolean(openNowSlot),
    nextSlot: nextSlot
      ? {
          slotId: nextSlot.id,
          startAt: nextSlot.startAtUtc,
          endAt: nextSlot.endAtUtc,
          localDate: nextSlot.localDate,
        }
      : null,
    schedulePreview: Array.from(scheduleByDate.values())
      .sort((left, right) => left.localDate.localeCompare(right.localDate))
      .map((item) => ({
        localDate: item.localDate,
        slotCount: item.slotCount,
        firstStartAt: item.firstStartAt,
        lastEndAt: item.lastEndAt,
      })),
    schedulePublishedAt: club.schedulePublishedAt,
    slotsGeneratedUntil: club.slotsGeneratedUntil,
    mapSummary: latestMapVersion
      ? {
          versionNumber: latestMapVersion.versionNumber,
          seatCount: latestMapVersion.seatCount,
          publishedAt: latestMapVersion.publishedAt,
        }
      : null,
    packageHighlights: packageHighlights.map((item) => ({
      id: item.id,
      name: item.name,
      durationMinutes: item.durationMinutes,
      pricingType: item.pricingType,
    })),
  })
}

