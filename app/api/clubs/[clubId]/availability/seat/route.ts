import { SlotStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { computeSeatAvailability, expireActiveHolds } from '@/src/lib/availabilityService'
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
  const seatId = asRequiredQueryParam(request.nextUrl.searchParams, 'seatId')

  if (!slotId || !seatId) {
    return NextResponse.json({ error: 'slotId and seatId are required.' }, { status: 400 })
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
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
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

  await expireActiveHolds(prisma, { clubId, slotId, seatId })
  const availability = await computeSeatAvailability({
    clubId,
    slotId,
    seatId,
    includeStaffDetails,
  })
  if (!availability.seat) {
    return NextResponse.json({ error: 'Seat was not found in published map.' }, { status: 404 })
  }

  const seat = availability.seat
  return NextResponse.json({
    clubId,
    slotId,
    mapVersionId: availability.mapVersionId,
    generatedAt: availability.generatedAt,
    seat: {
      seatId: seat.seatId,
      floorId: seat.floorId,
      roomId: seat.roomId,
      segmentId: seat.segmentId,
      label: seat.label,
      status: seat.status,
      ...(seat.holdExpiresAt ? { holdExpiresAt: seat.holdExpiresAt } : {}),
      ...(includeStaffDetails && seat.holdId ? { holdId: seat.holdId } : {}),
      ...(includeStaffDetails && seat.bookingId ? { bookingId: seat.bookingId } : {}),
    },
  })
}

