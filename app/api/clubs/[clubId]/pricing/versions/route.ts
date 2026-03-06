import { PricingVersionStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type CreateVersionBody = {
  effectiveFrom?: string
  effectiveTo?: string | null
}

function canManagePricing(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.roles.some(
    (role) => role.clubId === clubId && role.role === Role.TECH_ADMIN,
  )
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  const canAccess = context.roles.some((role) => role.clubId === clubId)
  if (!canAccess) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const versions = await prisma.pricingVersion.findMany({
    where: { clubId },
    orderBy: [{ versionNumber: 'desc' }],
    include: {
      _count: {
        select: { rules: true },
      },
    },
  })

  return NextResponse.json(versions)
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManagePricing(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: CreateVersionBody
  try {
    body = (await request.json()) as CreateVersionBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const now = new Date()
  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : now
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: 'Invalid effectiveFrom date.' }, { status: 400 })
  }
  const effectiveTo =
    body.effectiveTo == null || body.effectiveTo === '' ? null : new Date(body.effectiveTo)
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
    return NextResponse.json({ error: 'Invalid effectiveTo date.' }, { status: 400 })
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    return NextResponse.json(
      { error: 'effectiveTo must be greater than effectiveFrom.' },
      { status: 400 },
    )
  }

  const maxVersion = await prisma.pricingVersion.findFirst({
    where: { clubId },
    orderBy: { versionNumber: 'desc' },
  })

  const version = await prisma.pricingVersion.create({
    data: {
      clubId,
      versionNumber: (maxVersion?.versionNumber ?? 0) + 1,
      status: PricingVersionStatus.DRAFT,
      effectiveFrom,
      effectiveTo,
    },
  })

  return NextResponse.json(version, { status: 201 })
}
