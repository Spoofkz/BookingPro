import { NextRequest, NextResponse } from 'next/server'
import {
  parseDiscoveryQueryFromSearchParams,
  searchPublicClubs,
} from '@/src/lib/discoveryService'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const query = parseDiscoveryQueryFromSearchParams(request.nextUrl.searchParams)
  const result = await searchPublicClubs(query)

  return NextResponse.json({
    items: result.items.map((item) => ({
      clubId: item.clubId,
      slug: item.slug,
      name: item.name,
      coverImageUrl: item.coverImageUrl,
      area: item.area,
      city: item.city,
      startingFrom:
        item.startingFromAmount == null
          ? null
          : {
              amount: item.startingFromAmount,
              currency: item.currency,
              segment: item.startingFromSegment,
            },
      amenities: item.amenities,
      openNow: item.openNow,
      nextSlotAt: item.nextSlotAt,
      isFeatured: item.isFeatured,
      featuredRank: item.featuredRank,
      featuredBadge: item.featuredBadge,
      seatCount: item.seatCount,
      distanceKm: item.distanceKm,
    })),
    featured: result.featured.map((item) => ({
      clubId: item.clubId,
      slug: item.slug,
      name: item.name,
      coverImageUrl: item.coverImageUrl,
      area: item.area,
      city: item.city,
      startingFrom:
        item.startingFromAmount == null
          ? null
          : {
              amount: item.startingFromAmount,
              currency: item.currency,
              segment: item.startingFromSegment,
            },
      amenities: item.amenities,
      openNow: item.openNow,
      nextSlotAt: item.nextSlotAt,
      isFeatured: item.isFeatured,
      featuredRank: item.featuredRank,
      featuredBadge: item.featuredBadge,
      seatCount: item.seatCount,
      distanceKm: item.distanceKm,
    })),
    total: result.total,
    nextCursor: result.nextCursor,
  })
}

