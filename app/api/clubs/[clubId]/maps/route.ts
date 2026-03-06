import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { createDefaultSeatMapDraft } from '@/src/lib/seatMapSchema'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const existing = await prisma.seatMap.findUnique({
    where: { clubId },
    select: { id: true, draftRevision: true },
  })

  if (existing) {
    return NextResponse.json(
      {
        error: 'Map draft already exists for this club.',
        mapId: existing.id,
        draftRevision: existing.draftRevision,
      },
      { status: 409 },
    )
  }

  const mapId = crypto.randomUUID()
  const draft = createDefaultSeatMapDraft(mapId)

  const seatMap = await prisma.seatMap.create({
    data: {
      id: mapId,
      clubId,
      draftJson: JSON.stringify(draft),
      draftRevision: 1,
      updatedByUserId: context.userId,
    },
    select: {
      id: true,
      clubId: true,
      draftRevision: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json(
    {
      mapId: seatMap.id,
      clubId: seatMap.clubId,
      draftRevision: seatMap.draftRevision,
      createdAt: seatMap.createdAt,
      updatedAt: seatMap.updatedAt,
      draft,
    },
    { status: 201 },
  )
}
