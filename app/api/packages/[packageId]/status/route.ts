import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ packageId: string }>
}

type StatusBody = {
  isActive: boolean
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const { packageId } = await routeContext.params
  const context = await getCabinetContext()

  const pricingPackage = await prisma.pricingPackage.findUnique({
    where: { id: packageId },
  })

  if (!pricingPackage) {
    return NextResponse.json({ error: 'Package not found.' }, { status: 404 })
  }

  const canManage = context.roles.some(
    (role) => role.clubId === pricingPackage.clubId && role.role === Role.TECH_ADMIN,
  )
  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: StatusBody
  try {
    body = (await request.json()) as StatusBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (typeof body.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive boolean is required.' }, { status: 400 })
  }

  const updated = await prisma.pricingPackage.update({
    where: { id: packageId },
    data: { isActive: body.isActive },
  })

  return NextResponse.json(updated)
}
