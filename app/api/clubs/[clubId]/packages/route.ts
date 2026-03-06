import { ChannelType, PricingPackagePricingType, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { listApplicablePackages } from '@/src/lib/pricingEngine'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type CreatePackageBody = {
  name: string
  durationMinutes: number
  pricingType: PricingPackagePricingType
  fixedPriceCents?: number
  discountPercent?: number
  ratePerHourCents?: number
  visibleToClients?: boolean
  visibleToHosts?: boolean
  daysOfWeek?: number[]
  timeWindowStartMinute?: number
  timeWindowEndMinute?: number
  applyTimeModifiers?: boolean
  isActive?: boolean
  segmentIds?: string[]
  roomIds?: number[]
}

function canAccessClub(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.clubs.some((club) => club.id === clubId)
}

function canManagePricing(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.roles.some(
    (role) => role.clubId === clubId && role.role === Role.TECH_ADMIN,
  )
}

function csvFromNumberArray(values?: number[]) {
  if (!values || values.length === 0) return null
  return values.map((value) => String(value)).join(',')
}

function parseChannel(value: string | null, role: Role) {
  if (role === Role.CLIENT) return ChannelType.ONLINE
  if (value === ChannelType.ONLINE) return ChannelType.ONLINE
  if (value === ChannelType.OFFLINE) return ChannelType.OFFLINE
  return ChannelType.OFFLINE
}

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date
}

async function resolveSeatSegment(clubId: string, seatId: string) {
  const latestMapVersion = await prisma.seatMapVersion.findFirst({
    where: { clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!latestMapVersion) return null
  const seat = await prisma.seatIndex.findFirst({
    where: {
      clubId,
      mapVersionId: latestMapVersion.id,
      seatId,
      isActive: true,
      isDisabled: false,
    },
    select: {
      segmentId: true,
    },
  })
  return seat?.segmentId ?? null
}

function validatePackagePayload(body: CreatePackageBody) {
  const name = body.name?.trim()
  if (!name) return 'Package name is required.'
  if (!Number.isInteger(body.durationMinutes) || body.durationMinutes <= 0) {
    return 'durationMinutes must be a positive integer.'
  }

  if (body.pricingType === PricingPackagePricingType.FIXED_PRICE) {
    if (!Number.isInteger(body.fixedPriceCents) || (body.fixedPriceCents ?? 0) < 0) {
      return 'fixedPriceCents is required for FIXED_PRICE.'
    }
  }

  if (body.pricingType === PricingPackagePricingType.DISCOUNTED_HOURLY) {
    if (typeof body.discountPercent !== 'number' || body.discountPercent < 0) {
      return 'discountPercent is required for DISCOUNTED_HOURLY.'
    }
  }

  if (body.pricingType === PricingPackagePricingType.RATE_PER_HOUR) {
    if (!Number.isInteger(body.ratePerHourCents) || (body.ratePerHourCents ?? 0) < 0) {
      return 'ratePerHourCents is required for RATE_PER_HOUR.'
    }
  }

  return null
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const roomIdParam = searchParams.get('roomId')
  const roomId = roomIdParam ? Number(roomIdParam) : undefined
  if (roomIdParam && !Number.isInteger(roomId)) {
    return NextResponse.json({ error: 'roomId must be an integer.' }, { status: 400 })
  }
  const seatId = searchParams.get('seatId')?.trim() || ''
  let segmentId = searchParams.get('segmentId')?.trim() || undefined
  if (!segmentId && seatId) {
    segmentId = (await resolveSeatSegment(clubId, seatId)) ?? undefined
  }
  const hasQuoteContext = Boolean(segmentId) || Number.isInteger(roomId)
  const startAt = parseDate(searchParams.get('startAt'), new Date())
  const endAt = parseDate(
    searchParams.get('endAt'),
    new Date(startAt.getTime() + 60 * 60 * 1000),
  )
  const channel = parseChannel(searchParams.get('channel'), context.activeRole)

  if (context.activeRole === Role.CLIENT && !segmentId) {
    return NextResponse.json(
      { error: 'segmentId is required for client package discovery.' },
      { status: 400 },
    )
  }

  if (!hasQuoteContext) {
    const packages = await prisma.pricingPackage.findMany({
      where: {
        clubId,
        isActive: true,
      },
      include: {
        segmentLinks: true,
        roomLinks: true,
      },
      orderBy: [{ durationMinutes: 'asc' }, { name: 'asc' }],
    })

    const visiblePackages = packages.filter((pricingPackage) =>
      channel === ChannelType.ONLINE
        ? pricingPackage.visibleToClients
        : pricingPackage.visibleToHosts,
    )

    return NextResponse.json(visiblePackages)
  }

  const packages = await listApplicablePackages({
    clubId,
    roomId,
    segmentId,
    startAt,
    endAt,
    channel,
    customerType: 'GUEST',
    persistQuote: false,
  })

  const visiblePackages = packages.filter((pricingPackage) =>
    channel === ChannelType.ONLINE
      ? pricingPackage.visibleToClients
      : pricingPackage.visibleToHosts,
  )

  return NextResponse.json(visiblePackages)
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManagePricing(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: CreatePackageBody
  try {
    body = (await request.json()) as CreatePackageBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const validationError = validatePackagePayload(body)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const name = body.name.trim()
  const segmentIds = body.segmentIds ?? []
  const roomIds = body.roomIds ?? []

  const segmentCount = await prisma.segment.count({
    where: { clubId, id: { in: segmentIds } },
  })
  if (segmentIds.length > 0 && segmentCount !== segmentIds.length) {
    return NextResponse.json({ error: 'One or more segmentIds are invalid.' }, { status: 400 })
  }

  const roomCount = await prisma.room.count({
    where: { clubId, id: { in: roomIds } },
  })
  if (roomIds.length > 0 && roomCount !== roomIds.length) {
    return NextResponse.json({ error: 'One or more roomIds are invalid.' }, { status: 400 })
  }

  const pricingPackage = await prisma.pricingPackage.create({
    data: {
      clubId,
      name,
      durationMinutes: body.durationMinutes,
      pricingType: body.pricingType,
      fixedPriceCents: body.fixedPriceCents,
      discountPercent: body.discountPercent,
      ratePerHourCents: body.ratePerHourCents,
      visibleToClients: body.visibleToClients ?? true,
      visibleToHosts: body.visibleToHosts ?? true,
      daysOfWeekCsv: csvFromNumberArray(body.daysOfWeek),
      timeWindowStartMinute: body.timeWindowStartMinute ?? null,
      timeWindowEndMinute: body.timeWindowEndMinute ?? null,
      applyTimeModifiers: body.applyTimeModifiers ?? false,
      isActive: body.isActive ?? true,
      segmentLinks: {
        create: segmentIds.map((segmentId) => ({ segmentId })),
      },
      roomLinks: {
        create: roomIds.map((roomId) => ({ roomId })),
      },
    },
    include: {
      segmentLinks: true,
      roomLinks: true,
    },
  })

  return NextResponse.json(pricingPackage, { status: 201 })
}
