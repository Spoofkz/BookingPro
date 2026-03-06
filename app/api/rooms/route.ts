import { NextRequest, NextResponse } from 'next/server'
import {
  getCabinetContext,
} from '@/src/lib/cabinetContext'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type CreateRoomBody = {
  name: string
  slug?: string
  capacity: number
  pricePerNightCents: number
  segmentId?: string
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function GET(request: NextRequest) {
  const context = await getCabinetContext()
  let clubId: string | null = null
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: false })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
  }

  if (!clubId) {
    return NextResponse.json([])
  }

  try {
    requirePermissionInClub(context, clubId, PERMISSIONS.CLUB_READ)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const rooms = await prisma.room.findMany({
    where: { clubId },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(rooms)
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let clubId: string | null = null
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_CREATE)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: CreateRoomBody

  try {
    body = (await request.json()) as CreateRoomBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const name = body.name?.trim()
  const capacity = Number(body.capacity)
  const pricePerNightCents = Number(body.pricePerNightCents)
  const segmentId = body.segmentId?.trim() || null
  const slug = slugify(body.slug?.trim() || name)

  if (!name) {
    return NextResponse.json({ error: 'Room name is required.' }, { status: 400 })
  }

  if (!slug) {
    return NextResponse.json({ error: 'Room slug is invalid.' }, { status: 400 })
  }

  if (!Number.isInteger(capacity) || capacity < 1) {
    return NextResponse.json({ error: 'Capacity must be a positive integer.' }, { status: 400 })
  }

  if (!Number.isInteger(pricePerNightCents) || pricePerNightCents < 0) {
    return NextResponse.json(
      { error: 'Price per night must be zero or a positive integer (in cents).' },
      { status: 400 },
    )
  }

  if (segmentId) {
    const segment = await prisma.segment.findFirst({
      where: {
        id: segmentId,
        clubId,
      },
    })
    if (!segment) {
      return NextResponse.json(
        { error: 'segmentId is invalid for current club.' },
        { status: 400 },
      )
    }
  }

  const existing = await prisma.room.findUnique({
    where: { slug },
  })

  if (existing) {
    return NextResponse.json(
      { error: 'A booking place with this name/slug already exists.' },
      { status: 409 },
    )
  }

  const room = await prisma.room.create({
    data: {
      clubId,
      name,
      slug,
      capacity,
      pricePerNightCents,
      segmentId,
    },
  })

  return NextResponse.json(room, { status: 201 })
}
