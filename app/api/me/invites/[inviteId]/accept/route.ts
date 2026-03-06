import { MembershipStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ inviteId: string }>
}

export async function POST(_: NextRequest, routeContext: RouteContext) {
  const { inviteId } = await routeContext.params
  const context = await getCabinetContext()

  const invite = await prisma.clubMembership.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      clubId: true,
      userId: true,
      role: true,
      status: true,
      inviteExpiresAt: true,
    },
  })

  if (!invite || invite.userId !== context.userId) {
    return NextResponse.json({ error: 'Invite not found.' }, { status: 404 })
  }
  if (invite.status !== MembershipStatus.INVITED) {
    return NextResponse.json({ error: 'Invite is no longer pending.' }, { status: 409 })
  }
  if (invite.inviteExpiresAt && invite.inviteExpiresAt < new Date()) {
    return NextResponse.json({ error: 'Invite has expired.' }, { status: 409 })
  }

  const updated = await prisma.clubMembership.update({
    where: { id: invite.id },
    data: {
      status: MembershipStatus.ACTIVE,
      acceptedAt: new Date(),
      inviteToken: null,
      inviteExpiresAt: null,
    },
    select: {
      id: true,
      clubId: true,
      role: true,
      status: true,
      acceptedAt: true,
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId: updated.clubId,
      actorUserId: context.userId,
      action: 'club.member_invite_accepted',
      entityType: 'club_membership',
      entityId: updated.id,
      metadata: JSON.stringify({
        role: updated.role,
      }),
    },
  })

  return NextResponse.json(updated)
}
