import { BookingStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClub } from '@/src/lib/availabilityCache'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import {
  collectUniqueSegmentIdsFromInputs,
  parseSeatMapJson,
  serializeSeatGeometry,
  summarizeSeatDiff,
  validateSeatMapDocument,
} from '@/src/lib/seatMapSchema'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function activeStatuses() {
  return [
    BookingStatus.HELD,
    BookingStatus.PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.CHECKED_IN,
  ]
}

function floorSeatSummary(items: Array<{ floorId: string }>) {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.floorId, (counts.get(item.floorId) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([floorId, seatCount]) => ({ floorId, seatCount }))
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const seatMap = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true, draftJson: true, draftRevision: true },
  })
  if (!seatMap) {
    return NextResponse.json({ error: 'Map draft was not found.' }, { status: 404 })
  }

  const currentDraft = parseSeatMapJson(seatMap.draftJson)
  if (!currentDraft) {
    return NextResponse.json({ error: 'Draft map JSON is corrupted.' }, { status: 500 })
  }

  const validation = validateSeatMapDocument(currentDraft, 'publish')
  if (validation.errors.length > 0 || !validation.document) {
    return NextResponse.json(
      {
        error: 'Publish validation failed.',
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 400 },
    )
  }

  if (validation.document.mapId !== seatMap.id) {
    return NextResponse.json(
      { error: 'Draft mapId does not match persisted mapId.' },
      { status: 400 },
    )
  }

  const segmentIds = collectUniqueSegmentIdsFromInputs(validation.seatIndexInputs)
  const segmentCount = await prisma.segment.count({
    where: {
      clubId,
      isActive: true,
      id: { in: segmentIds },
    },
  })
  if (segmentCount !== segmentIds.length) {
    return NextResponse.json(
      { error: 'One or more seats reference inactive or unknown segmentId values.' },
      { status: 400 },
    )
  }

  const latestVersion = await prisma.seatMapVersion.findFirst({
    where: { mapId: seatMap.id },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true },
  })

  const previousSeatIndex = latestVersion
    ? await prisma.seatIndex.findMany({
        where: { mapVersionId: latestVersion.id },
      select: {
        seatId: true,
        label: true,
        segmentId: true,
        roomId: true,
        seatType: true,
        geometryJson: true,
        isDisabled: true,
        disabledReason: true,
      },
    })
    : []

  const nextSeatIndex = validation.seatIndexInputs.map((item) => ({
    seatId: item.seatId,
    label: item.label,
    segmentId: item.segmentId,
    roomId: item.roomId,
    seatType: item.seatType,
    geometryJson: serializeSeatGeometry(item.geometry),
    isDisabled: item.isDisabled,
    disabledReason: item.disabledReason,
  }))

  const previousSeatIds = new Set(previousSeatIndex.map((item) => item.seatId))
  const nextSeatIds = new Set(nextSeatIndex.map((item) => item.seatId))
  const removedSeatIds = Array.from(previousSeatIds).filter((seatId) => !nextSeatIds.has(seatId))

  if (removedSeatIds.length > 0) {
    const conflictingBookings = await prisma.booking.findMany({
      where: {
        clubId,
        seatId: { in: removedSeatIds },
        checkIn: { gte: new Date() },
        status: { in: activeStatuses() },
      },
      select: {
        id: true,
        seatId: true,
      },
      take: 10,
    })

    if (conflictingBookings.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot remove seats that are used by future active bookings.',
          recommendation: 'Disable seats (isDisabled=true) instead of deleting them.',
          blockedSeats: Array.from(
            new Set(conflictingBookings.map((booking) => booking.seatId).filter(Boolean)),
          ),
          sampleBookingIds: conflictingBookings.map((booking) => booking.id),
        },
        { status: 409 },
      )
    }
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 0) + 1
  const publishedDocument = {
    ...validation.document,
    version: nextVersionNumber,
  }

  const diffSummary = summarizeSeatDiff(previousSeatIndex, nextSeatIndex)
  const seatCountByFloor = floorSeatSummary(validation.seatIndexInputs)

  const result = await prisma.$transaction(async (tx) => {
    const version = await tx.seatMapVersion.create({
      data: {
        mapId: seatMap.id,
        clubId,
        versionNumber: nextVersionNumber,
        publishedJson: JSON.stringify(publishedDocument),
        seatCount: validation.seatIndexInputs.length,
        publishedByUserId: context.userId,
      },
      select: {
        id: true,
        mapId: true,
        versionNumber: true,
        seatCount: true,
        publishedAt: true,
        publishedByUserId: true,
      },
    })

    await tx.seatIndex.createMany({
      data: validation.seatIndexInputs.map((item) => ({
        seatId: item.seatId,
        mapVersionId: version.id,
        clubId,
        floorId: item.floorId,
        roomId: item.roomId,
        segmentId: item.segmentId,
        label: item.label,
        seatType: item.seatType,
        geometryJson: serializeSeatGeometry(item.geometry),
        isActive: true,
        isDisabled: item.isDisabled,
        disabledReason: item.disabledReason,
      })),
    })

    await tx.seatMap.update({
      where: { id: seatMap.id },
      data: {
        draftJson: JSON.stringify(publishedDocument),
        draftRevision: { increment: 1 },
        updatedByUserId: context.userId,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'map.version_published',
        entityType: 'seat_map_version',
        entityId: version.id,
        metadata: JSON.stringify({
          mapId: seatMap.id,
          versionNumber: version.versionNumber,
          seatCount: version.seatCount,
          seatCountByFloor,
          diffSummary,
        }),
      },
    })

    return version
  })

  invalidateAvailabilityCacheForClub(clubId)

  return NextResponse.json(
    {
      mapId: result.mapId,
      mapVersionId: result.id,
      versionNumber: result.versionNumber,
      seatCount: result.seatCount,
      publishedAt: result.publishedAt,
      publishedByUserId: result.publishedByUserId,
      draftRevision: seatMap.draftRevision + 1,
      warnings: validation.warnings,
      diffSummary,
      seatCountByFloor,
    },
    { status: 201 },
  )
}
