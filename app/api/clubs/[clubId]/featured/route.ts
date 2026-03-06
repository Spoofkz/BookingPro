import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type FeaturedPayload = {
  featuredRank: number
  featuredStartAt: string
  featuredEndAt: string
  badgeText?: string | null
  isActive?: boolean
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const now = new Date()
  const items = await prisma.clubFeatured.findMany({
    where: { clubId },
    orderBy: [{ featuredStartAt: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  })

  return NextResponse.json({
    items,
    activeNow: items.find(
      (item) =>
        item.isActive &&
        item.featuredStartAt <= now &&
        item.featuredEndAt > now,
    ) ?? null,
  })
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: FeaturedPayload
  try {
    payload = (await request.json()) as FeaturedPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const featuredRank = Number(payload.featuredRank)
  if (!Number.isInteger(featuredRank) || featuredRank < 1 || featuredRank > 9999) {
    return NextResponse.json(
      { error: 'featuredRank must be an integer between 1 and 9999.' },
      { status: 400 },
    )
  }

  const featuredStartAt = new Date(payload.featuredStartAt)
  const featuredEndAt = new Date(payload.featuredEndAt)
  if (Number.isNaN(featuredStartAt.getTime()) || Number.isNaN(featuredEndAt.getTime())) {
    return NextResponse.json({ error: 'featuredStartAt and featuredEndAt must be valid dates.' }, { status: 400 })
  }
  if (featuredEndAt <= featuredStartAt) {
    return NextResponse.json({ error: 'featuredEndAt must be greater than featuredStartAt.' }, { status: 400 })
  }

  const club = await prisma.club.findUnique({
    where: { id: clubId },
    select: { id: true, status: true },
  })
  if (!club) {
    return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
  }
  if (club.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: 'Only PUBLISHED clubs can be featured.' },
      { status: 409 },
    )
  }

  const feature = await prisma.clubFeatured.create({
    data: {
      clubId,
      featuredRank,
      featuredStartAt,
      featuredEndAt,
      badgeText: payload.badgeText?.trim() || null,
      isActive: payload.isActive ?? true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.featured_configured',
      entityType: 'club_featured',
      entityId: feature.id,
      metadata: JSON.stringify({
        featuredRank: feature.featuredRank,
        featuredStartAt: feature.featuredStartAt.toISOString(),
        featuredEndAt: feature.featuredEndAt.toISOString(),
        isActive: feature.isActive,
      }),
    },
  })

  return NextResponse.json(feature, { status: 201 })
}

