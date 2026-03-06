import { SlotStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import {
  floorAvailabilityCacheKey,
  readFloorAvailabilityCache,
  writeFloorAvailabilityCache,
} from '@/src/lib/availabilityCache'
import { computeFloorAvailability, expireActiveHolds } from '@/src/lib/availabilityService'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function asRequiredQueryParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const slotId = asRequiredQueryParam(request.nextUrl.searchParams, 'slotId')
  const floorId = asRequiredQueryParam(request.nextUrl.searchParams, 'floorId')

  if (!slotId || !floorId) {
    return NextResponse.json({ error: 'slotId and floorId are required.' }, { status: 400 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  let includeStaffDetails = false
  try {
    const context = await getCabinetContext()
    if (canAccessClub(context, clubId)) {
      requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_READ)
      includeStaffDetails = true
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.code !== 'INSUFFICIENT_PERMISSION') {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
    }
    includeStaffDetails = false
  }

  if (!includeStaffDetails) {
    if (normalizeClubStatus(club.status) !== CLUB_STATUSES.PUBLISHED) {
      return NextResponse.json({ error: 'Availability is not available.' }, { status: 404 })
    }
  }

  const slot = await prisma.slot.findFirst({
    where: {
      id: slotId,
      clubId,
    },
    select: {
      id: true,
      status: true,
    },
  })
  if (!slot) {
    return NextResponse.json({ error: 'Slot was not found.' }, { status: 404 })
  }

  if (!includeStaffDetails && slot.status !== SlotStatus.PUBLISHED) {
    return NextResponse.json({ error: 'Slot is not available.' }, { status: 404 })
  }

  const cacheKey = floorAvailabilityCacheKey({
    clubId,
    slotId,
    floorId,
    includeStaffDetails,
  })
  const cached = readFloorAvailabilityCache<{
    mapVersionId: string | null
    generatedAt: Date
    seats: ReturnType<typeof normalizeAvailabilitySeat>[]
  }>(cacheKey)
  if (cached) {
    return NextResponse.json({
      clubId,
      slotId,
      floorId,
      mapVersionId: cached.mapVersionId,
      generatedAt: cached.generatedAt,
      seats: cached.seats,
    })
  }

  await expireActiveHolds(prisma, { clubId, slotId })
  const availability = await computeFloorAvailability({
    clubId,
    slotId,
    floorId,
    includeStaffDetails,
  })

  const responsePayload = {
    clubId,
    slotId,
    floorId,
    mapVersionId: availability.mapVersionId,
    generatedAt: availability.generatedAt,
    seats: availability.seats.map((seat) => normalizeAvailabilitySeat(seat, includeStaffDetails)),
  }

  writeFloorAvailabilityCache(cacheKey, responsePayload)
  return NextResponse.json(responsePayload)
}

function normalizeAvailabilitySeat(
  seat: {
    seatId: string
    status: string
    holdExpiresAt: Date | null
    holdId?: string
    bookingId?: number
  },
  includeStaffDetails: boolean,
) {
  return {
    seatId: seat.seatId,
    status: seat.status,
    ...(seat.holdExpiresAt ? { holdExpiresAt: seat.holdExpiresAt } : {}),
    ...(includeStaffDetails && seat.holdId ? { holdId: seat.holdId } : {}),
    ...(includeStaffDetails && seat.bookingId ? { bookingId: seat.bookingId } : {}),
  }
}
