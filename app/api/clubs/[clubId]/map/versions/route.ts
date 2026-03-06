import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const map = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true },
  })

  if (!map) {
    return NextResponse.json({ mapId: null, items: [] })
  }

  const versions = await prisma.seatMapVersion.findMany({
    where: { mapId: map.id },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      versionNumber: true,
      seatCount: true,
      publishedAt: true,
      publishedByUserId: true,
    },
  })

  return NextResponse.json({
    mapId: map.id,
    items: versions,
  })
}
