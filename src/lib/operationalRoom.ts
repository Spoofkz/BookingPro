import { Prisma } from '@prisma/client'

type RoomShape = {
  id: number
  clubId: string | null
  segmentId: string | null
}

function normalizeSlugToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function findPreferredRoom(params: {
  tx: Prisma.TransactionClient
  clubId: string
  preferredRoomId?: number | null
}) {
  if (!params.preferredRoomId) return null
  return params.tx.room.findFirst({
    where: {
      id: params.preferredRoomId,
      clubId: params.clubId,
    },
    select: {
      id: true,
      clubId: true,
      segmentId: true,
    },
  })
}

async function findSegmentRoom(params: {
  tx: Prisma.TransactionClient
  clubId: string
  segmentId?: string | null
}) {
  if (!params.segmentId) return null
  return params.tx.room.findFirst({
    where: {
      clubId: params.clubId,
      segmentId: params.segmentId,
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      clubId: true,
      segmentId: true,
    },
  })
}

async function findAnyClubRoom(params: {
  tx: Prisma.TransactionClient
  clubId: string
}) {
  return params.tx.room.findFirst({
    where: { clubId: params.clubId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      clubId: true,
      segmentId: true,
    },
  })
}

async function createAutoRoom(params: {
  tx: Prisma.TransactionClient
  clubId: string
  segmentId?: string | null
}): Promise<RoomShape> {
  const segment = params.segmentId
    ? await params.tx.segment.findFirst({
        where: {
          id: params.segmentId,
          clubId: params.clubId,
        },
        select: { id: true, name: true },
      })
    : null

  const clubToken = normalizeSlugToken(params.clubId).slice(-8) || 'club'
  const segmentToken =
    normalizeSlugToken(segment?.id ?? params.segmentId ?? 'default').slice(-8) || 'default'
  const slugBase = normalizeSlugToken(`auto-${clubToken}-${segmentToken}`) || `auto-${clubToken}`
  const nameBase = 'Operational Room'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? slugBase : `${slugBase}-${attempt + 1}`
    const name = attempt === 0 ? nameBase : `${nameBase} ${attempt + 1}`
    try {
      const room = await params.tx.room.create({
        data: {
          clubId: params.clubId,
          segmentId: segment?.id ?? null,
          name,
          slug,
          capacity: 1,
          pricePerNightCents: 0,
        },
        select: {
          id: true,
          clubId: true,
          segmentId: true,
        },
      })
      return room
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        continue
      }
      throw error
    }
  }

  throw new Error('Failed to auto-provision operational room.')
}

export async function resolveOrCreateOperationalRoom(params: {
  tx: Prisma.TransactionClient
  clubId: string
  preferredRoomId?: number | null
  seatSegmentId?: string | null
}): Promise<RoomShape> {
  const preferred = await findPreferredRoom({
    tx: params.tx,
    clubId: params.clubId,
    preferredRoomId: params.preferredRoomId,
  })
  if (preferred) return preferred

  const segmentRoom = await findSegmentRoom({
    tx: params.tx,
    clubId: params.clubId,
    segmentId: params.seatSegmentId ?? null,
  })
  if (segmentRoom) return segmentRoom

  const anyRoom = await findAnyClubRoom({
    tx: params.tx,
    clubId: params.clubId,
  })
  if (anyRoom) return anyRoom

  return createAutoRoom({
    tx: params.tx,
    clubId: params.clubId,
    segmentId: params.seatSegmentId ?? null,
  })
}
