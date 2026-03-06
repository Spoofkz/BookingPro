import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ segmentId: string }>
}

type UpdateSegmentBody = {
  name?: string
  description?: string | null
  color?: string | null
  icon?: string | null
  isActive?: boolean
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { segmentId } = await routeContext.params
  const context = await getCabinetContext()

  const existing = await prisma.segment.findUnique({
    where: { id: segmentId },
  })

  if (!existing) {
    return NextResponse.json({ error: 'Segment not found.' }, { status: 404 })
  }

  const canManage = context.roles.some(
    (role) => role.clubId === existing.clubId && role.role === Role.TECH_ADMIN,
  )
  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: UpdateSegmentBody
  try {
    body = (await request.json()) as UpdateSegmentBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (body.name !== undefined && !name) {
    return NextResponse.json({ error: 'Segment name cannot be empty.' }, { status: 400 })
  }

  if (name && name !== existing.name) {
    const duplicate = await prisma.segment.findFirst({
      where: {
        clubId: existing.clubId,
        name,
        id: { not: existing.id },
      },
    })
    if (duplicate) {
      return NextResponse.json({ error: 'Segment name already exists.' }, { status: 409 })
    }
  }

  const segment = await prisma.segment.update({
    where: { id: segmentId },
    data: {
      name: name ?? undefined,
      description:
        body.description === undefined ? undefined : body.description?.trim() || null,
      color: body.color === undefined ? undefined : body.color?.trim() || null,
      icon: body.icon === undefined ? undefined : body.icon?.trim() || null,
      isActive: body.isActive,
    },
  })

  return NextResponse.json(segment)
}
