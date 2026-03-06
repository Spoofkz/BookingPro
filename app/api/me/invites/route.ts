import { MembershipStatus } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const context = await getCabinetContext()

  const invites = await prisma.clubMembership.findMany({
    where: {
      userId: context.userId,
      status: MembershipStatus.INVITED,
    },
    include: {
      club: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      invitedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
  })

  return NextResponse.json({
    items: invites.map((invite) => ({
      id: invite.id,
      clubId: invite.clubId,
      club: invite.club,
      role: invite.role,
      status: invite.status,
      inviteToken: invite.inviteToken,
      inviteExpiresAt: invite.inviteExpiresAt,
      invitedBy: invite.invitedBy,
      createdAt: invite.createdAt,
    })),
  })
}
