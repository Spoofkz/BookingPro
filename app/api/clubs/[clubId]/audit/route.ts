import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

function parseDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const searchParams = request.nextUrl.searchParams
  const action = searchParams.get('action')?.trim()
  const entityType = searchParams.get('entityType')?.trim()
  const dateFrom = parseDate(searchParams.get('dateFrom'))
  const dateTo = parseDate(searchParams.get('dateTo'))

  if (searchParams.get('dateFrom') && !dateFrom) {
    return NextResponse.json({ error: 'dateFrom is invalid.' }, { status: 400 })
  }
  if (searchParams.get('dateTo') && !dateTo) {
    return NextResponse.json({ error: 'dateTo is invalid.' }, { status: 400 })
  }

  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
  const skip = (page - 1) * pageSize

  const where: {
    clubId: string
    action?: string
    entityType?: string
    createdAt?: { gte?: Date; lte?: Date }
  } = {
    clubId,
  }

  if (action) where.action = action
  if (entityType) where.entityType = entityType
  if (dateFrom || dateTo) {
    where.createdAt = {}
    if (dateFrom) where.createdAt.gte = dateFrom
    if (dateTo) where.createdAt.lte = dateTo
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
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
      metadata: item.metadata,
      actor: item.actor
        ? {
            id: item.actor.id,
            name: item.actor.name,
            email: item.actor.email,
            phone: item.actor.phone,
          }
        : null,
    })),
    page,
    pageSize,
    total,
  })
}
