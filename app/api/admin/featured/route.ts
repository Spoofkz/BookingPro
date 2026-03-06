import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, asTrimmedString, createPlatformAuditLog } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURED_MANAGE)
    const items = await prisma.clubFeatured.findMany({
      include: {
        club: {
          include: {
            verification: true,
          },
        },
      },
      orderBy: [{ featuredStartAt: 'desc' }, { featuredRank: 'asc' }],
      take: 200,
    })

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        clubId: item.clubId,
        clubName: item.club.name,
        clubSlug: item.club.slug,
        clubStatus: item.club.status,
        verificationStatus: item.club.verification?.status ?? 'UNVERIFIED',
        featuredRank: item.featuredRank,
        badgeText: item.badgeText,
        featuredStartAt: item.featuredStartAt,
        featuredEndAt: item.featuredEndAt,
        isActive: item.isActive,
      })),
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.FEATURED_MANAGE)
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }
    const clubId = asTrimmedString(payload.clubId)
    if (!clubId) return NextResponse.json({ error: 'clubId is required.' }, { status: 400 })
    const featuredRank = Number(payload.featuredRank)
    const featuredStartAt = new Date(String(payload.featuredStartAt || ''))
    const featuredEndAt = new Date(String(payload.featuredEndAt || ''))
    const badgeText = asTrimmedString(payload.badgeText)?.slice(0, 50) ?? null
    const isActive = payload.isActive !== false

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

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      include: { verification: true },
    })
    if (!club) return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
    if (club.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Only PUBLISHED clubs can be featured.' }, { status: 409 })
    }
    if ((club.verification?.status ?? 'UNVERIFIED') !== 'VERIFIED') {
      return NextResponse.json({ error: 'Only VERIFIED clubs can be featured.' }, { status: 409 })
    }

    const entry = await prisma.clubFeatured.create({
      data: {
        clubId,
        featuredRank,
        badgeText,
        featuredStartAt,
        featuredEndAt,
        isActive,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId,
      action: 'platform.featured.created',
      entityType: 'club_featured',
      entityId: entry.id,
      metadata: {
        featuredRank,
        featuredStartAt: entry.featuredStartAt,
        featuredEndAt: entry.featuredEndAt,
        isActive: entry.isActive,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

