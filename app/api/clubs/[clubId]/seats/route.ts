import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { parseSeatMapJson } from '@/src/lib/seatMapSchema'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseMapVersionParam(value: string | null) {
  if (!value || value === 'latest') {
    return { latest: true as const, versionNumber: null }
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return { latest: false as const, versionNumber: parsed }
}

function parseGeometry(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const map = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true },
  })
  if (!map) {
    return NextResponse.json({ error: 'Map is not initialized for this club.' }, { status: 404 })
  }

  const requestedVersion = parseMapVersionParam(request.nextUrl.searchParams.get('mapVersion'))
  if (!requestedVersion) {
    return NextResponse.json({ error: 'mapVersion must be "latest" or a positive integer.' }, { status: 400 })
  }

  const version = requestedVersion.latest
    ? await prisma.seatMapVersion.findFirst({
        where: { mapId: map.id },
        orderBy: { versionNumber: 'desc' },
        select: { id: true, versionNumber: true },
      })
    : await prisma.seatMapVersion.findFirst({
        where: { mapId: map.id, versionNumber: requestedVersion.versionNumber ?? undefined },
        select: { id: true, versionNumber: true },
      })

  if (!version) {
    return NextResponse.json({ error: 'Published map version was not found.' }, { status: 404 })
  }

  const floorId = request.nextUrl.searchParams.get('floorId')?.trim() || undefined

  const seats = await prisma.seatIndex.findMany({
    where: {
      clubId,
      mapVersionId: version.id,
      isActive: true,
      floorId,
    },
    orderBy: [{ floorId: 'asc' }, { label: 'asc' }],
    select: {
      seatId: true,
      floorId: true,
      roomId: true,
      segmentId: true,
      label: true,
      seatType: true,
      geometryJson: true,
      isDisabled: true,
      disabledReason: true,
    },
  })

  const publishedMap = await prisma.seatMapVersion.findUnique({
    where: { id: version.id },
    select: { publishedJson: true },
  })
  const publishedDocument = publishedMap ? parseSeatMapJson(publishedMap.publishedJson) : null

  return NextResponse.json({
    mapVersionId: version.id,
    versionNumber: version.versionNumber,
    floors:
      publishedDocument?.floors.map((floor) => ({
        floorId: floor.floorId,
        name: floor.name,
        plane: floor.plane,
        background: floor.background ?? null,
        rooms: floor.rooms.map((room) => ({
          roomId: room.roomId,
          name: room.name,
          shape: room.shape,
        })),
      })) ?? [],
    seats: seats.map((seat) => ({
      seatId: seat.seatId,
      floorId: seat.floorId,
      roomId: seat.roomId,
      segmentId: seat.segmentId,
      label: seat.label,
      seatType: seat.seatType,
      geometry: parseGeometry(seat.geometryJson),
      isDisabled: seat.isDisabled,
      disabledReason: seat.disabledReason,
    })),
  })
}
