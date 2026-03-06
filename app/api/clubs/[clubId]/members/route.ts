import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { canAccessClub, canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type CreateMemberPayload = {
  email: string
  role: Role
}

function parseRole(input: string | undefined): Role | null {
  if (input === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (input === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

export async function GET(_: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canAccessClub(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const members = await prisma.clubMembership.findMany({
    where: { clubId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
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
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({
    items: members.map((member) => ({
      id: member.id,
      role: member.role,
      status: member.status,
      inviteToken: member.inviteToken,
      inviteExpiresAt: member.inviteExpiresAt,
      acceptedAt: member.acceptedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      invitedBy: member.invitedBy,
      user: member.user,
    })),
  })
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: CreateMemberPayload
  try {
    payload = (await request.json()) as CreateMemberPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const email = payload.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'email is required.' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email format is invalid.' }, { status: 400 })
  }

  const role = parseRole(payload.role)
  if (!role) {
    return NextResponse.json(
      { error: 'role must be HOST_ADMIN or TECH_ADMIN.' },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, phone: true },
  })
  if (!user) {
    return NextResponse.json({ error: 'User with this email was not found.' }, { status: 404 })
  }

  const membership = await prisma.clubMembership.upsert({
    where: {
      clubId_userId_role: {
        clubId,
        userId: user.id,
        role,
      },
    },
    update: {
      status: 'ACTIVE',
      invitedByUserId: context.userId,
      inviteToken: null,
      inviteExpiresAt: null,
      acceptedAt: new Date(),
    },
    create: {
      clubId,
      userId: user.id,
      role,
      status: 'ACTIVE',
      invitedByUserId: context.userId,
      acceptedAt: new Date(),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.member_assigned',
      entityType: 'club_membership',
      entityId: membership.id,
      metadata: JSON.stringify({
        role: membership.role,
        userId: membership.userId,
      }),
    },
  })

  return NextResponse.json(
    {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      acceptedAt: membership.acceptedAt,
      createdAt: membership.createdAt,
      user: membership.user,
    },
    { status: 201 },
  )
}
