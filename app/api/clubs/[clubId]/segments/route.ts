import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type CreateSegmentBody = {
  name: string
  description?: string
  color?: string
  icon?: string
  isActive?: boolean
}

function canAccessClub(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.clubs.some((club) => club.id === clubId)
}

function canManagePricing(context: Awaited<ReturnType<typeof getCabinetContext>>, clubId: string) {
  return context.roles.some(
    (role) => role.clubId === clubId && role.role === Role.TECH_ADMIN,
  )
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const segments = await prisma.segment.findMany({
    where: { clubId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })

  return NextResponse.json(segments)
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManagePricing(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: CreateSegmentBody
  try {
    body = (await request.json()) as CreateSegmentBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ error: 'Segment name is required.' }, { status: 400 })
  }

  const existing = await prisma.segment.findFirst({
    where: {
      clubId,
      name,
    },
  })

  if (existing) {
    return NextResponse.json({ error: 'Segment with this name already exists.' }, { status: 409 })
  }

  const segment = await prisma.segment.create({
    data: {
      clubId,
      name,
      description: body.description?.trim() || null,
      color: body.color?.trim() || null,
      icon: body.icon?.trim() || null,
      isActive: body.isActive ?? true,
    },
  })

  return NextResponse.json(segment, { status: 201 })
}
