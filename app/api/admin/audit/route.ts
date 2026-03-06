import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, parseDateOrNull, parsePage } from '@/src/lib/platformAdminApi'
import { PLATFORM_PERMISSIONS, requirePlatformPermission } from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.AUDIT_READ)
    const searchParams = request.nextUrl.searchParams
    const action = searchParams.get('action')?.trim()
    const entityType = searchParams.get('entityType')?.trim()
    const actorUserId = searchParams.get('actorUserId')?.trim()
    const clubId = searchParams.get('clubId')?.trim()
    const dateFrom = parseDateOrNull(searchParams.get('dateFrom'))
    const dateTo = parseDateOrNull(searchParams.get('dateTo'))
    if (searchParams.get('dateFrom') && !dateFrom) {
      return NextResponse.json({ error: 'dateFrom is invalid.' }, { status: 400 })
    }
    if (searchParams.get('dateTo') && !dateTo) {
      return NextResponse.json({ error: 'dateTo is invalid.' }, { status: 400 })
    }

    const { page, pageSize, skip } = parsePage(searchParams)
    const where: Record<string, unknown> = {}
    if (action) where.action = action
    if (entityType) where.entityType = entityType
    if (actorUserId) where.actorUserId = actorUserId
    if (clubId) where.clubId = clubId
    if (dateFrom || dateTo) {
      where.createdAt = {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      }
    }

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: {
            select: { id: true, name: true, email: true },
          },
          club: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ])

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        clubId: item.clubId,
        club: item.club,
        actor: item.actor,
        bookingId: item.bookingId,
        metadata: item.metadata,
      })),
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

