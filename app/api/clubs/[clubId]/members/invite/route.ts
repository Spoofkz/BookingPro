import { MembershipStatus, Role, UserStatus } from '@prisma/client'
import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { canManageClubAsTechAdmin } from '@/src/lib/clubAccess'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

type InvitePayload = {
  email?: string
  phone?: string
  role?: Role
}

function parseRole(input: string | undefined) {
  if (input === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (input === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

function normalizeEmail(input: string | undefined) {
  const value = input?.trim().toLowerCase() || ''
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}

function normalizePhone(input: string | undefined) {
  const value = input?.replace(/[^\d+]/g, '').trim() || ''
  if (!value) return null
  if (!/^\+?\d{7,15}$/.test(value)) return null
  return value.startsWith('+') ? value : `+${value}`
}

function randomInviteToken() {
  return crypto.randomBytes(24).toString('hex')
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { clubId } = await routeContext.params
  const context = await getCabinetContext()

  if (!canManageClubAsTechAdmin(context, clubId)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let payload: InvitePayload
  try {
    payload = (await request.json()) as InvitePayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const role = parseRole(payload.role)
  const email = normalizeEmail(payload.email)
  const phone = normalizePhone(payload.phone)
  const validationErrors: Array<{ field: string; message: string }> = []

  if (!role) {
    validationErrors.push({
      field: 'role',
      message: 'role must be HOST_ADMIN or TECH_ADMIN.',
    })
  }
  if (!email && !phone) {
    validationErrors.push({
      field: 'contact',
      message: 'Either email or phone is required.',
    })
  }
  if (payload.email && !email) {
    validationErrors.push({
      field: 'email',
      message: 'email format is invalid.',
    })
  }
  if (payload.phone && !phone) {
    validationErrors.push({
      field: 'phone',
      message: 'phone format is invalid.',
    })
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Validation failed.',
        fields: validationErrors,
      },
      { status: 400 },
    )
  }

  let user = email
    ? await prisma.user.findUnique({ where: { email } })
    : null
  if (!user && phone) {
    user = await prisma.user.findUnique({ where: { phone } })
  }

  if (!user) {
    const display = email || phone || 'User'
    user = await prisma.user.create({
      data: {
        name: display,
        email,
        phone,
        status: UserStatus.ACTIVE,
      },
    })
  } else {
    const patchData: { email?: string; phone?: string } = {}
    if (!user.email && email) patchData.email = email
    if (!user.phone && phone) patchData.phone = phone
    if (Object.keys(patchData).length > 0) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: patchData,
      })
    }
  }

  const existing = await prisma.clubMembership.findUnique({
    where: {
      clubId_userId_role: {
        clubId,
        userId: user.id,
        role: role as Role,
      },
    },
  })
  if (existing?.status === MembershipStatus.ACTIVE) {
    return NextResponse.json(
      { code: 'ALREADY_MEMBER', error: 'User is already an active member with this role.' },
      { status: 409 },
    )
  }

  const inviteToken = randomInviteToken()
  const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const membership = await prisma.clubMembership.upsert({
    where: {
      clubId_userId_role: {
        clubId,
        userId: user.id,
        role: role as Role,
      },
    },
    update: {
      status: MembershipStatus.INVITED,
      invitedByUserId: context.userId,
      inviteToken,
      inviteExpiresAt,
      acceptedAt: null,
    },
    create: {
      clubId,
      userId: user.id,
      role: role as Role,
      status: MembershipStatus.INVITED,
      invitedByUserId: context.userId,
      inviteToken,
      inviteExpiresAt,
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
      action: 'club.member_invited',
      entityType: 'club_membership',
      entityId: membership.id,
      metadata: JSON.stringify({
        role: membership.role,
        userId: membership.userId,
        inviteExpiresAt: inviteExpiresAt.toISOString(),
      }),
    },
  })

  return NextResponse.json(
    {
      id: membership.id,
      role: membership.role,
      status: membership.status,
      inviteToken: membership.inviteToken,
      inviteExpiresAt: membership.inviteExpiresAt,
      user: membership.user,
    },
    { status: 201 },
  )
}
