import { MembershipStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; membershipId: string }>
}

type UpdateMemberPayload = {
  role?: Role
  status?: MembershipStatus
}

function parseRole(input: string | undefined) {
  if (input === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (input === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

function parseMembershipStatus(input: string | undefined) {
  if (input === MembershipStatus.ACTIVE) return MembershipStatus.ACTIVE
  if (input === MembershipStatus.INVITED) return MembershipStatus.INVITED
  if (input === MembershipStatus.DISABLED) return MembershipStatus.DISABLED
  return null
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const { clubId, membershipId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: UpdateMemberPayload
  try {
    payload = (await request.json()) as UpdateMemberPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const requestedRole =
    payload.role === undefined ? undefined : parseRole(payload.role)
  if (payload.role !== undefined && !requestedRole) {
    return NextResponse.json(
      { error: 'role must be HOST_ADMIN or TECH_ADMIN.' },
      { status: 400 },
    )
  }

  const requestedStatus =
    payload.status === undefined ? undefined : parseMembershipStatus(payload.status)
  if (payload.status !== undefined && !requestedStatus) {
    return NextResponse.json(
      { error: 'status must be ACTIVE, INVITED, or DISABLED.' },
      { status: 400 },
    )
  }

  if (requestedRole === undefined && requestedStatus === undefined) {
    return NextResponse.json(
      { error: 'Nothing to update. Provide role and/or status.' },
      { status: 400 },
    )
  }

  const existing = await prisma.clubMembership.findFirst({
    where: {
      id: membershipId,
      clubId,
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

  if (!existing) {
    return NextResponse.json({ error: 'Membership not found.' }, { status: 404 })
  }

  const nextRole = requestedRole ?? existing.role
  const nextStatus = requestedStatus ?? existing.status
  const acceptedAtValue =
    nextStatus === MembershipStatus.ACTIVE
      ? new Date()
      : nextStatus === MembershipStatus.INVITED
        ? null
        : existing.acceptedAt

  const activeTechCount = await prisma.clubMembership.count({
    where: {
      clubId,
      role: Role.TECH_ADMIN,
      status: MembershipStatus.ACTIVE,
    },
  })
  const disablesLastTechAdmin =
    existing.role === Role.TECH_ADMIN &&
    existing.status === MembershipStatus.ACTIVE &&
    (nextRole !== Role.TECH_ADMIN || nextStatus !== MembershipStatus.ACTIVE) &&
    activeTechCount <= 1

  if (disablesLastTechAdmin) {
    return NextResponse.json(
      {
        code: 'LAST_TECH_ADMIN_REQUIRED',
        error: 'Cannot disable or demote the last active TECH_ADMIN.',
      },
      { status: 409 },
    )
  }

  const membership = await prisma.$transaction(async (tx) => {
    if (nextRole === existing.role) {
      return tx.clubMembership.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          invitedByUserId: context.userId,
          acceptedAt: acceptedAtValue,
          inviteToken: nextStatus === MembershipStatus.ACTIVE ? null : existing.inviteToken,
          inviteExpiresAt: nextStatus === MembershipStatus.ACTIVE ? null : existing.inviteExpiresAt,
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
    }

    const updatedOrCreated = await tx.clubMembership.upsert({
      where: {
        clubId_userId_role: {
          clubId,
          userId: existing.userId,
          role: nextRole,
        },
      },
      update: {
        status: nextStatus,
        invitedByUserId: context.userId,
        acceptedAt: acceptedAtValue,
        inviteToken: nextStatus === MembershipStatus.ACTIVE ? null : undefined,
        inviteExpiresAt: nextStatus === MembershipStatus.ACTIVE ? null : undefined,
      },
      create: {
        clubId,
        userId: existing.userId,
        role: nextRole,
        status: nextStatus,
        invitedByUserId: context.userId,
        acceptedAt: acceptedAtValue,
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

    if (updatedOrCreated.id !== existing.id) {
      await tx.clubMembership.update({
        where: { id: existing.id },
        data: { status: MembershipStatus.DISABLED },
      })
    }

    return updatedOrCreated
  })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'club.member_updated',
      entityType: 'club_membership',
      entityId: membership.id,
      metadata: JSON.stringify({
        previousRole: existing.role,
        previousStatus: existing.status,
        nextRole: membership.role,
        nextStatus: membership.status,
        userId: membership.userId,
      }),
    },
  })

  return NextResponse.json({
    id: membership.id,
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
    user: membership.user,
  })
}
