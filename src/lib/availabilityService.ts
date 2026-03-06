import { HoldStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { seatBlockingBookingStatuses } from '@/src/lib/bookingLifecycle'
import { prisma } from '@/src/lib/prisma'

export const AVAILABILITY_STATUSES = {
  AVAILABLE: 'AVAILABLE',
  HELD: 'HELD',
  BOOKED: 'BOOKED',
  DISABLED: 'DISABLED',
} as const

export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[keyof typeof AVAILABILITY_STATUSES]

type DbClient = PrismaClient | Prisma.TransactionClient

type SeatCatalogItem = {
  seatId: string
  floorId: string
  roomId: string | null
  segmentId: string
  label: string
  isDisabled: boolean
  disabledReason: string | null
}

type SeatAvailabilityBase = {
  seatId: string
  status: AvailabilityStatus
  holdExpiresAt: Date | null
}

export type FloorSeatAvailability = SeatAvailabilityBase & {
  holdId?: string
  bookingId?: number
}

export type SeatAvailability = SeatAvailabilityBase & {
  floorId: string
  roomId: string | null
  segmentId: string
  label: string
  holdId?: string
  bookingId?: number
}

export type FloorAvailabilityResult = {
  mapVersionId: string | null
  generatedAt: Date
  seats: FloorSeatAvailability[]
}

export type SeatAvailabilityResult = {
  mapVersionId: string | null
  generatedAt: Date
  seat: SeatAvailability | null
}

export async function expireActiveHolds(
  db: DbClient,
  params: {
    clubId: string
    slotId?: string
    seatId?: string
    now?: Date
  },
) {
  const now = params.now ?? new Date()
  await db.hold.updateMany({
    where: {
      clubId: params.clubId,
      slotId: params.slotId,
      seatId: params.seatId,
      status: HoldStatus.ACTIVE,
      expiresAtUtc: { lte: now },
    },
    data: {
      status: HoldStatus.EXPIRED,
    },
  })
}

async function latestMapVersionIdForClub(db: DbClient, clubId: string) {
  const latestVersion = await db.seatMapVersion.findFirst({
    where: { clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  return latestVersion?.id ?? null
}

async function seatCatalogForFloor(
  db: DbClient,
  params: { clubId: string; floorId: string },
): Promise<{ mapVersionId: string | null; seats: SeatCatalogItem[] }> {
  const mapVersionId = await latestMapVersionIdForClub(db, params.clubId)
  if (!mapVersionId) return { mapVersionId: null, seats: [] }

  const seats = await db.seatIndex.findMany({
    where: {
      clubId: params.clubId,
      mapVersionId,
      floorId: params.floorId,
      isActive: true,
    },
    orderBy: [{ label: 'asc' }, { seatId: 'asc' }],
    select: {
      seatId: true,
      floorId: true,
      roomId: true,
      segmentId: true,
      label: true,
      isDisabled: true,
      disabledReason: true,
    },
  })

  return { mapVersionId, seats }
}

async function seatCatalogBySeatId(
  db: DbClient,
  params: { clubId: string; seatId: string },
): Promise<{ mapVersionId: string | null; seat: SeatCatalogItem | null }> {
  const mapVersionId = await latestMapVersionIdForClub(db, params.clubId)
  if (!mapVersionId) return { mapVersionId: null, seat: null }

  const seat = await db.seatIndex.findFirst({
    where: {
      clubId: params.clubId,
      mapVersionId,
      seatId: params.seatId,
      isActive: true,
    },
    select: {
      seatId: true,
      floorId: true,
      roomId: true,
      segmentId: true,
      label: true,
      isDisabled: true,
      disabledReason: true,
    },
  })

  return { mapVersionId, seat }
}

function statusForSeat(params: {
  seat: SeatCatalogItem
  bookingBySeatId: Map<string, { bookingId: number }>
  holdBySeatId: Map<string, { holdId: string; expiresAtUtc: Date }>
  includeStaffDetails: boolean
}): FloorSeatAvailability {
  if (params.seat.isDisabled) {
    return {
      seatId: params.seat.seatId,
      status: AVAILABILITY_STATUSES.DISABLED,
      holdExpiresAt: null,
    }
  }

  const booking = params.bookingBySeatId.get(params.seat.seatId)
  if (booking) {
    return {
      seatId: params.seat.seatId,
      status: AVAILABILITY_STATUSES.BOOKED,
      holdExpiresAt: null,
      ...(params.includeStaffDetails ? { bookingId: booking.bookingId } : {}),
    }
  }

  const hold = params.holdBySeatId.get(params.seat.seatId)
  if (hold) {
    return {
      seatId: params.seat.seatId,
      status: AVAILABILITY_STATUSES.HELD,
      holdExpiresAt: hold.expiresAtUtc,
      ...(params.includeStaffDetails ? { holdId: hold.holdId } : {}),
    }
  }

  return {
    seatId: params.seat.seatId,
    status: AVAILABILITY_STATUSES.AVAILABLE,
    holdExpiresAt: null,
  }
}

export async function computeFloorAvailability(params: {
  clubId: string
  slotId: string
  floorId: string
  includeStaffDetails: boolean
  now?: Date
}) {
  const db = prisma
  const generatedAt = params.now ?? new Date()
  const catalog = await seatCatalogForFloor(db, {
    clubId: params.clubId,
    floorId: params.floorId,
  })
  if (catalog.seats.length === 0) {
    return {
      mapVersionId: catalog.mapVersionId,
      generatedAt,
      seats: [],
    } satisfies FloorAvailabilityResult
  }

  const seatIds = catalog.seats.map((seat) => seat.seatId)
  const [bookings, holds] = await Promise.all([
    db.booking.findMany({
      where: {
        clubId: params.clubId,
        slotId: params.slotId,
        seatId: { in: seatIds },
        status: { in: [...seatBlockingBookingStatuses()] },
      },
      select: {
        id: true,
        seatId: true,
      },
      orderBy: { id: 'desc' },
    }),
    db.hold.findMany({
      where: {
        clubId: params.clubId,
        slotId: params.slotId,
        seatId: { in: seatIds },
        status: HoldStatus.ACTIVE,
        expiresAtUtc: { gt: generatedAt },
      },
      select: {
        id: true,
        seatId: true,
        expiresAtUtc: true,
      },
      orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const bookingBySeatId = new Map<string, { bookingId: number }>()
  for (const booking of bookings) {
    if (!booking.seatId || bookingBySeatId.has(booking.seatId)) continue
    bookingBySeatId.set(booking.seatId, { bookingId: booking.id })
  }

  const holdBySeatId = new Map<string, { holdId: string; expiresAtUtc: Date }>()
  for (const hold of holds) {
    if (holdBySeatId.has(hold.seatId)) continue
    holdBySeatId.set(hold.seatId, { holdId: hold.id, expiresAtUtc: hold.expiresAtUtc })
  }

  return {
    mapVersionId: catalog.mapVersionId,
    generatedAt,
    seats: catalog.seats.map((seat) =>
      statusForSeat({
        seat,
        bookingBySeatId,
        holdBySeatId,
        includeStaffDetails: params.includeStaffDetails,
      }),
    ),
  } satisfies FloorAvailabilityResult
}

export async function computeSeatAvailability(params: {
  clubId: string
  slotId: string
  seatId: string
  includeStaffDetails: boolean
  now?: Date
}) {
  const db = prisma
  const generatedAt = params.now ?? new Date()
  const catalog = await seatCatalogBySeatId(db, {
    clubId: params.clubId,
    seatId: params.seatId,
  })
  if (!catalog.seat) {
    return {
      mapVersionId: catalog.mapVersionId,
      generatedAt,
      seat: null,
    } satisfies SeatAvailabilityResult
  }

  const [booking, hold] = await Promise.all([
    db.booking.findFirst({
      where: {
        clubId: params.clubId,
        slotId: params.slotId,
        seatId: params.seatId,
        status: { in: [...seatBlockingBookingStatuses()] },
      },
      select: {
        id: true,
      },
      orderBy: { id: 'desc' },
    }),
    db.hold.findFirst({
      where: {
        clubId: params.clubId,
        slotId: params.slotId,
        seatId: params.seatId,
        status: HoldStatus.ACTIVE,
        expiresAtUtc: { gt: generatedAt },
      },
      select: {
        id: true,
        expiresAtUtc: true,
      },
      orderBy: [{ expiresAtUtc: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  const bookingBySeatId = new Map<string, { bookingId: number }>()
  if (booking) {
    bookingBySeatId.set(params.seatId, { bookingId: booking.id })
  }

  const holdBySeatId = new Map<string, { holdId: string; expiresAtUtc: Date }>()
  if (hold) {
    holdBySeatId.set(params.seatId, { holdId: hold.id, expiresAtUtc: hold.expiresAtUtc })
  }

  const base = statusForSeat({
    seat: catalog.seat,
    bookingBySeatId,
    holdBySeatId,
    includeStaffDetails: params.includeStaffDetails,
  })
  const statusDetails = {
    status: base.status,
    holdExpiresAt: base.holdExpiresAt,
    ...(base.holdId ? { holdId: base.holdId } : {}),
    ...(typeof base.bookingId === 'number' ? { bookingId: base.bookingId } : {}),
  }

  return {
    mapVersionId: catalog.mapVersionId,
    generatedAt,
    seat: {
      seatId: catalog.seat.seatId,
      floorId: catalog.seat.floorId,
      roomId: catalog.seat.roomId,
      segmentId: catalog.seat.segmentId,
      label: catalog.seat.label,
      ...statusDetails,
    },
  } satisfies SeatAvailabilityResult
}
