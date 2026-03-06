import { PricingPackagePricingType, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ packageId: string }>
}

type UpdatePackageBody = {
  name?: string
  durationMinutes?: number
  pricingType?: PricingPackagePricingType
  fixedPriceCents?: number | null
  discountPercent?: number | null
  ratePerHourCents?: number | null
  visibleToClients?: boolean
  visibleToHosts?: boolean
  daysOfWeek?: number[]
  timeWindowStartMinute?: number | null
  timeWindowEndMinute?: number | null
  applyTimeModifiers?: boolean
  isActive?: boolean
  segmentIds?: string[]
  roomIds?: number[]
}

function csvFromNumberArray(values?: number[]) {
  if (!values || values.length === 0) return null
  return values.map((value) => String(value)).join(',')
}

function canManagePricing(
  context: Awaited<ReturnType<typeof getCabinetContext>>,
  clubId: string,
) {
  return context.roles.some(
    (role) => role.clubId === clubId && role.role === Role.TECH_ADMIN,
  )
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { packageId } = await routeContext.params
  const context = await getCabinetContext()

  const existing = await prisma.pricingPackage.findUnique({
    where: { id: packageId },
    include: { segmentLinks: true, roomLinks: true },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Package not found.' }, { status: 404 })
  }

  if (!canManagePricing(context, existing.clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: UpdatePackageBody
  try {
    body = (await request.json()) as UpdatePackageBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (body.durationMinutes !== undefined) {
    if (!Number.isInteger(body.durationMinutes) || body.durationMinutes <= 0) {
      return NextResponse.json({ error: 'durationMinutes must be positive integer.' }, { status: 400 })
    }
  }

  const nextPricingType = body.pricingType ?? existing.pricingType
  const nextFixedPrice =
    body.fixedPriceCents === undefined ? existing.fixedPriceCents : body.fixedPriceCents
  const nextDiscountPercent =
    body.discountPercent === undefined ? existing.discountPercent : body.discountPercent
  const nextRatePerHour =
    body.ratePerHourCents === undefined ? existing.ratePerHourCents : body.ratePerHourCents

  if (nextPricingType === PricingPackagePricingType.FIXED_PRICE) {
    if (!Number.isInteger(nextFixedPrice) || (nextFixedPrice ?? 0) < 0) {
      return NextResponse.json({ error: 'fixedPriceCents must be set for FIXED_PRICE.' }, { status: 400 })
    }
  }

  if (nextPricingType === PricingPackagePricingType.DISCOUNTED_HOURLY) {
    if (typeof nextDiscountPercent !== 'number' || nextDiscountPercent < 0) {
      return NextResponse.json({ error: 'discountPercent must be set for DISCOUNTED_HOURLY.' }, { status: 400 })
    }
  }

  if (nextPricingType === PricingPackagePricingType.RATE_PER_HOUR) {
    if (!Number.isInteger(nextRatePerHour) || (nextRatePerHour ?? 0) < 0) {
      return NextResponse.json({ error: 'ratePerHourCents must be set for RATE_PER_HOUR.' }, { status: 400 })
    }
  }

  const segmentIds = body.segmentIds
  if (segmentIds) {
    const segmentCount = await prisma.segment.count({
      where: { clubId: existing.clubId, id: { in: segmentIds } },
    })
    if (segmentCount !== segmentIds.length) {
      return NextResponse.json({ error: 'One or more segmentIds are invalid.' }, { status: 400 })
    }
  }

  const roomIds = body.roomIds
  if (roomIds) {
    const roomCount = await prisma.room.count({
      where: { clubId: existing.clubId, id: { in: roomIds } },
    })
    if (roomCount !== roomIds.length) {
      return NextResponse.json({ error: 'One or more roomIds are invalid.' }, { status: 400 })
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (segmentIds) {
      await tx.packageSegment.deleteMany({
        where: { packageId: existing.id },
      })
      if (segmentIds.length > 0) {
        await tx.packageSegment.createMany({
          data: segmentIds.map((segmentId) => ({
            packageId: existing.id,
            segmentId,
          })),
        })
      }
    }

    if (roomIds) {
      await tx.packageRoom.deleteMany({
        where: { packageId: existing.id },
      })
      if (roomIds.length > 0) {
        await tx.packageRoom.createMany({
          data: roomIds.map((roomId) => ({
            packageId: existing.id,
            roomId,
          })),
        })
      }
    }

    return tx.pricingPackage.update({
      where: { id: existing.id },
      data: {
        name: body.name?.trim() || undefined,
        durationMinutes: body.durationMinutes,
        pricingType: body.pricingType,
        fixedPriceCents:
          body.fixedPriceCents === undefined ? undefined : body.fixedPriceCents,
        discountPercent:
          body.discountPercent === undefined ? undefined : body.discountPercent,
        ratePerHourCents:
          body.ratePerHourCents === undefined ? undefined : body.ratePerHourCents,
        visibleToClients: body.visibleToClients,
        visibleToHosts: body.visibleToHosts,
        daysOfWeekCsv:
          body.daysOfWeek === undefined
            ? undefined
            : csvFromNumberArray(body.daysOfWeek),
        timeWindowStartMinute: body.timeWindowStartMinute,
        timeWindowEndMinute: body.timeWindowEndMinute,
        applyTimeModifiers: body.applyTimeModifiers,
        isActive: body.isActive,
      },
      include: {
        segmentLinks: true,
        roomLinks: true,
      },
    })
  })

  return NextResponse.json(updated)
}
