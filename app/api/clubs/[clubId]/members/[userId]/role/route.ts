import { MembershipStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; userId: string }>
}

type Payload = {
  role?: Role
}

function parseRole(input: string | undefined) {
  if (input === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (input === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId, userId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const targetRole = parseRole(payload.role)
  if (!targetRole) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'role must be HOST_ADMIN or TECH_ADMIN.',
      },
      { status: 400 },
    )
  }

  const existingMemberships = await prisma.clubMembership.findMany({
    where: {
      clubId,
      userId,
      role: { in: [Role.HOST_ADMIN, Role.TECH_ADMIN] },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  if (existingMemberships.length === 0) {
    return NextResponse.json({ error: 'Membership was not found for user.' }, { status: 404 })
  }

  const current =
    existingMemberships.find((membership) => membership.status === MembershipStatus.ACTIVE) ||
    existingMemberships[0]

  if (current.role === targetRole && current.status !== MembershipStatus.DISABLED) {
    return NextResponse.json({
      id: current.id,
      role: current.role,
      status: current.status,
    })
  }

  const activeTechCount = await prisma.clubMembership.count({
    where: { clubId, role: Role.TECH_ADMIN, status: MembershipStatus.ACTIVE },
  })
  const demotesLastTech =
    current.role === Role.TECH_ADMIN &&
    current.status === MembershipStatus.ACTIVE &&
    targetRole !== Role.TECH_ADMIN &&
    activeTechCount <= 1

  if (demotesLastTech) {
    return NextResponse.json(
      {
        code: 'LAST_TECH_ADMIN_REQUIRED',
        error: 'Cannot demote the last active TECH_ADMIN.',
      },
      { status: 409 },
    )
  }

  const targetStatus =
    current.status === MembershipStatus.DISABLED ? MembershipStatus.ACTIVE : current.status
  const acceptedAt = targetStatus === MembershipStatus.ACTIVE ? new Date() : null

  const membership = await prisma.$transaction(async (tx) => {
    const target = await tx.clubMembership.upsert({
      where: {
        clubId_userId_role: {
          clubId,
          userId,
          role: targetRole,
        },
      },
      update: {
        status: targetStatus,
        invitedByUserId: context.userId,
        acceptedAt,
        inviteToken: targetStatus === MembershipStatus.ACTIVE ? null : undefined,
        inviteExpiresAt: targetStatus === MembershipStatus.ACTIVE ? null : undefined,
      },
      create: {
        clubId,
        userId,
        role: targetRole,
        status: targetStatus,
        invitedByUserId: context.userId,
        acceptedAt,
      },
    })

    await tx.clubMembership.updateMany({
      where: {
        clubId,
        userId,
        role: { in: [Role.HOST_ADMIN, Role.TECH_ADMIN] },
        id: { not: target.id },
        status: { not: MembershipStatus.DISABLED },
      },
      data: {
        status: MembershipStatus.DISABLED,
      },
    })

    return target
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.member_role_changed',
      entityType: 'club_membership',
      entityId: membership.id,
      metadata: JSON.stringify({
        userId,
        previousRole: current.role,
        nextRole: membership.role,
      }),
    },
  })

  return NextResponse.json({
    id: membership.id,
    role: membership.role,
    status: membership.status,
  })
}
