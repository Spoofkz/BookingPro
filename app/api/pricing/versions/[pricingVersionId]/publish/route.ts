import { PricingVersionStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { refreshClubStartingFromHint } from '@/src/lib/discoveryPricingHints'
import { prisma } from '@/src/lib/prisma'
import { validatePricingVersionForPublish } from '@/src/lib/pricingPublishValidation'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ pricingVersionId: string }>
}

type PublishBody = {
  effectiveFrom?: string
  effectiveTo?: string | null
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { pricingVersionId } = await routeContext.params
  const context = await getCabinetContext()

  const pricingVersion = await prisma.pricingVersion.findUnique({
    where: { id: pricingVersionId },
    include: { rules: true },
  })

  if (!pricingVersion) {
    return NextResponse.json({ error: 'Pricing version not found.' }, { status: 404 })
  }

  const canManage = context.roles.some(
    (role) => role.clubId === pricingVersion.clubId && role.role === Role.TECH_ADMIN,
  )
  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: PublishBody = {}
  try {
    body = (await request.json()) as PublishBody
  } catch {
    body = {}
  }

  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date()
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Invalid effectiveFrom.',
      },
      { status: 400 },
    )
  }
  const effectiveTo =
    body.effectiveTo == null || body.effectiveTo === ''
      ? null
      : new Date(body.effectiveTo)
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Invalid effectiveTo.',
      },
      { status: 400 },
    )
  }

  if (pricingVersion.status !== PricingVersionStatus.DRAFT) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: `Cannot publish pricing version from status ${pricingVersion.status}.`,
      },
      { status: 409 },
    )
  }

  const validation = await validatePricingVersionForPublish({
    clubId: pricingVersion.clubId,
    pricingVersion,
    effectiveFrom,
    effectiveTo,
  })

  if (!validation.canPublish) {
    return NextResponse.json(
      {
        code: 'PRICING_PUBLISH_BLOCKED',
        blockers: validation.blockers,
        details: validation.details,
      },
      { status: 409 },
    )
  }

  const publishAt = new Date()
  const published = await prisma.$transaction(async (tx) => {
    if (validation.autoClosableVersionIds.length > 0) {
      await tx.pricingVersion.updateMany({
        where: { id: { in: validation.autoClosableVersionIds } },
        data: { effectiveTo: effectiveFrom },
      })
    }

    const next = await tx.pricingVersion.update({
      where: { id: pricingVersion.id },
      data: {
        status: PricingVersionStatus.PUBLISHED,
        effectiveFrom,
        effectiveTo,
        publishedAt: publishAt,
        publishedByUserId: context.userId,
      },
    })

    await refreshClubStartingFromHint({
      db: tx,
      clubId: pricingVersion.clubId,
      pricingVersionId: next.id,
    })

    await tx.auditLog.create({
      data: {
        clubId: pricingVersion.clubId,
        actorUserId: context.userId,
        action: 'pricing.version_published',
        entityType: 'pricing_version',
        entityId: pricingVersion.id,
        metadata: JSON.stringify({
          effectiveFrom: next.effectiveFrom.toISOString(),
          effectiveTo: next.effectiveTo?.toISOString() ?? null,
          versionNumber: next.versionNumber,
          autoClosedVersionIds: validation.autoClosableVersionIds,
        }),
      },
    })

    return next
  })

  return NextResponse.json({
    ...published,
    validation: {
      blockers: validation.blockers,
      details: validation.details,
      autoClosedVersionIds: validation.autoClosableVersionIds,
    },
  })
}
