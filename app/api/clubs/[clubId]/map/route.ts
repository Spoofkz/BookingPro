import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CLUB_STATUSES, normalizeClubStatus } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'
import { parseSeatMapJson } from '@/src/lib/seatMapSchema'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseRequestedVersion(value: string | null) {
  if (!value || value === 'latest') {
    return { latest: true as const, versionNumber: null }
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return { latest: false as const, versionNumber: parsed }
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }

  let isStaffAccess = false
  try {
    const context = await getCabinetContext()
    isStaffAccess = canAccessClub(context, clubId)
  } catch {
    isStaffAccess = false
  }

  const isPublicPublished = normalizeClubStatus(club.status) === CLUB_STATUSES.PUBLISHED
  if (!isStaffAccess && !isPublicPublished) {
    return NextResponse.json({ error: 'Map is not available.' }, { status: 404 })
  }

  const map = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true },
  })

  if (!map) {
    return NextResponse.json({ error: 'Map is not initialized for this club.' }, { status: 404 })
  }

  const requested = parseRequestedVersion(request.nextUrl.searchParams.get('version'))
  if (!requested) {
    return NextResponse.json({ error: 'version must be "latest" or a positive integer.' }, { status: 400 })
  }

  const version = requested.latest
    ? await prisma.seatMapVersion.findFirst({
        where: { mapId: map.id },
        orderBy: { versionNumber: 'desc' },
      })
    : await prisma.seatMapVersion.findFirst({
        where: {
          mapId: map.id,
          versionNumber: requested.versionNumber ?? undefined,
        },
      })

  if (!version) {
    return NextResponse.json({ error: 'Published map version was not found.' }, { status: 404 })
  }

  const mapJson = parseSeatMapJson(version.publishedJson)
  if (!mapJson) {
    return NextResponse.json({ error: 'Published map JSON is corrupted.' }, { status: 500 })
  }

  return NextResponse.json({
    mapId: map.id,
    mapVersionId: version.id,
    versionNumber: version.versionNumber,
    publishedAt: version.publishedAt,
    seatCount: version.seatCount,
    map: mapJson,
  })
}
