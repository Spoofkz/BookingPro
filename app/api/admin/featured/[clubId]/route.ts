import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ clubId: string }> }

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURED_MANAGE)
    const { clubId } = await routeContext.params
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const current = await prisma.clubFeatured.findFirst({
      where: { clubId },
      orderBy: [{ createdAt: 'desc' }],
    })
    if (!current) {
      return NextResponse.json({ error: 'No featured entry found for club.' }, { status: 404 })
    }

    const featuredRank =
      payload.featuredRank === undefined ? current.featuredRank : Number(payload.featuredRank)
    const featuredStartAt =
      payload.featuredStartAt === undefined
        ? current.featuredStartAt
        : new Date(String(payload.featuredStartAt))
    const featuredEndAt =
      payload.featuredEndAt === undefined
        ? current.featuredEndAt
        : new Date(String(payload.featuredEndAt))
    const badgeText =
      payload.badgeText === undefined
        ? current.badgeText
        : (asTrimmedString(payload.badgeText)?.slice(0, 50) ?? null)
    const isActive =
      payload.isActive === undefined ? current.isActive : payload.isActive === true

    if (!Number.isInteger(featuredRank) || featuredRank < 1 || featuredRank > 9999) {
      return NextResponse.json({ error: 'featuredRank is invalid.' }, { status: 400 })
    }
    if (
      Number.isNaN(featuredStartAt.getTime()) ||
      Number.isNaN(featuredEndAt.getTime()) ||
      featuredEndAt <= featuredStartAt
    ) {
      return NextResponse.json({ error: 'featuredStartAt/featuredEndAt are invalid.' }, { status: 400 })
    }

    const updated = await prisma.clubFeatured.update({
      where: { id: current.id },
      data: {
        featuredRank,
        featuredStartAt,
        featuredEndAt,
        badgeText,
        isActive,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.featured.updated',
      entityType: 'club_featured',
      entityId: updated.id,
      metadata: {
        before: current,
        after: updated,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function DELETE(_: NextRequest, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURED_MANAGE)
    const { clubId } = await routeContext.params
    const current = await prisma.clubFeatured.findFirst({
      where: { clubId },
      orderBy: [{ createdAt: 'desc' }],
    })
    if (!current) {
      return NextResponse.json({ error: 'No featured entry found for club.' }, { status: 404 })
    }

    const updated = await prisma.clubFeatured.update({
      where: { id: current.id },
      data: { isActive: false },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.featured.deleted',
      entityType: 'club_featured',
      entityId: updated.id,
      metadata: { before: current, after: updated },
    })

    return NextResponse.json({ clubId, featuredId: updated.id, isActive: updated.isActive })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

