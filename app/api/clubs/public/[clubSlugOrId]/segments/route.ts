import { NextResponse } from 'next/server'
import { isPublishedClub } from '@/src/lib/clubLifecycle'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubSlugOrId: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { clubSlugOrId } = await routeContext.params
  const club = await prisma.club.findFirst({
    where: {
      OR: [{ id: clubSlugOrId }, { slug: clubSlugOrId }],
    },
    select: { id: true, status: true },
  })
  if (!club || !isPublishedClub(club.status)) {
    return NextResponse.json({ error: 'Club not available.' }, { status: 404 })
  }

  const segments = await prisma.segment.findMany({
    where: {
      clubId: club.id,
      isActive: true,
    },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
    },
  })

  return NextResponse.json({ items: segments })
}
