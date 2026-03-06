import { PricingVersionStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; pricingVersionId: string }>
}

type UpdateBody = {
  effectiveFrom?: string
  effectiveTo?: string | null
}

function canAccessClub(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.roles.some((role) => role.clubId === clubId)
}

function canManagePricing(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.roles.some(
    (role) => role.clubId === clubId && role.role === Role.TECH_ADMIN,
  )
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId, pricingVersionId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const version = await prisma.pricingVersion.findFirst({
    where: { id: pricingVersionId, clubId },
    include: {
      rules: {
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!version) {
    return NextResponse.json({ error: 'Pricing version not found.' }, { status: 404 })
  }

  return NextResponse.json(version)
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { clubId, pricingVersionId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManagePricing(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const existing = await prisma.pricingVersion.findFirst({
    where: { id: pricingVersionId, clubId },
    select: { id: true, status: true, effectiveFrom: true, effectiveTo: true },
  })
  if (!existing) {
    return NextResponse.json({ error: 'Pricing version not found.' }, { status: 404 })
  }
  if (existing.status !== PricingVersionStatus.DRAFT) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: 'Only draft pricing versions can be edited.',
      },
      { status: 409 },
    )
  }

  let body: UpdateBody
  try {
    body = (await request.json()) as UpdateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const nextEffectiveFrom =
    body.effectiveFrom == null ? existing.effectiveFrom : new Date(body.effectiveFrom)
  if (Number.isNaN(nextEffectiveFrom.getTime())) {
    return NextResponse.json({ error: 'Invalid effectiveFrom.' }, { status: 400 })
  }

  const nextEffectiveTo =
    body.effectiveTo === undefined
      ? existing.effectiveTo
      : body.effectiveTo == null || body.effectiveTo === ''
        ? null
        : new Date(body.effectiveTo)
  if (nextEffectiveTo && Number.isNaN(nextEffectiveTo.getTime())) {
    return NextResponse.json({ error: 'Invalid effectiveTo.' }, { status: 400 })
  }
  if (nextEffectiveTo && nextEffectiveTo <= nextEffectiveFrom) {
    return NextResponse.json(
      { error: 'effectiveTo must be greater than effectiveFrom.' },
      { status: 400 },
    )
  }

  const updated = await prisma.pricingVersion.update({
    where: { id: existing.id },
    data: {
      effectiveFrom: body.effectiveFrom === undefined ? undefined : nextEffectiveFrom,
      effectiveTo: body.effectiveTo === undefined ? undefined : nextEffectiveTo,
    },
  })

  return NextResponse.json(updated)
}

