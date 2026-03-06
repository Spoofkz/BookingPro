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

  const memberships = await prisma.clubMembership.findMany({
    where: {
      clubId,
      userId,
      role: { in: [Role.HOST_ADMIN, Role.TECH_ADMIN] },
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
    },
  })
  if (memberships.length === 0) {
    return NextResponse.json({ error: 'No active/invited membership found for user.' }, { status: 404 })
  }

  const activeTechCount = await prisma.clubMembership.count({
    where: {
      clubId,
      role: Role.TECH_ADMIN,
      status: MembershipStatus.ACTIVE,
    },
  })
  const userActiveTechCount = memberships.filter(
    (membership) =>
      membership.role === Role.TECH_ADMIN && membership.status === MembershipStatus.ACTIVE,
  ).length

  if (userActiveTechCount > 0 && activeTechCount <= userActiveTechCount) {
    return NextResponse.json(
      {
        code: 'LAST_TECH_ADMIN_REQUIRED',
        error: 'Cannot disable the last active TECH_ADMIN.',
      },
      { status: 409 },
    )
  }

  await prisma.clubMembership.updateMany({
    where: {
      clubId,
      userId,
      role: { in: [Role.HOST_ADMIN, Role.TECH_ADMIN] },
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
    },
    data: {
      status: MembershipStatus.DISABLED,
      inviteToken: null,
      inviteExpiresAt: null,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.member_disabled',
      entityType: 'user',
      entityId: userId,
    },
  })

  return NextResponse.json({ ok: true })
}
