import { MembershipStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; userId: string }>
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { clubId, userId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const disabledMemberships = await prisma.clubMembership.findMany({
    where: {
      clubId,
      userId,
      role: { in: [Role.HOST_ADMIN, Role.TECH_ADMIN] },
      status: MembershipStatus.DISABLED,
    },
    orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
  })
  if (disabledMemberships.length === 0) {
    return NextResponse.json({ error: 'No disabled membership found for user.' }, { status: 404 })
  }

  await prisma.clubMembership.updateMany({
    where: {
      id: {
        in: disabledMemberships.map((membership) => membership.id),
      },
    },
    data: {
      status: MembershipStatus.ACTIVE,
      invitedByUserId: context.userId,
      acceptedAt: new Date(),
      inviteToken: null,
      inviteExpiresAt: null,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.member_enabled',
      entityType: 'user',
      entityId: userId,
    },
  })

  return NextResponse.json({ ok: true })
}
