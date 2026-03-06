import { Role } from '@prisma/client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { buildCapabilitySnapshot, isDemoAuthEnabled } from '@/src/lib/authSession'
import {
  ACTIVE_CLUB_COOKIE,
  ACTIVE_MODE_COOKIE,
  ACTIVE_ROLE_COOKIE,
  DEMO_USER_COOKIE,
  getCabinetContext,
} from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type ContextPayload = {
  clubId?: string | null
  role?: Role | null
  activeMode?: 'CLIENT' | 'STAFF'
  userEmail?: string
}

function parseRole(value: string | null | undefined): Role | null {
  if (!value) return null
  if (value === Role.CLIENT) return Role.CLIENT
  if (value === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (value === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

export async function POST(request: NextRequest) {
  let payload: ContextPayload

  try {
    payload = (await request.json()) as ContextPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const cookieStore = await cookies()
  if (payload.userEmail) {
    if (!isDemoAuthEnabled()) {
      return NextResponse.json({ error: 'Demo user switching is disabled.' }, { status: 403 })
    }

    const user = await prisma.user.findUnique({
      where: { email: payload.userEmail.trim().toLowerCase() },
    })
    if (!user) {
      return NextResponse.json({ error: 'Unknown demo user email.' }, { status: 404 })
    }

    cookieStore.set(DEMO_USER_COOKIE, user.email || '', {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
    cookieStore.delete(ACTIVE_ROLE_COOKIE)
    cookieStore.delete(ACTIVE_MODE_COOKIE)
    cookieStore.delete(ACTIVE_CLUB_COOKIE)
  }

  let context
  try {
    context = await getCabinetContext()
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const requestedClubId = payload.clubId === undefined ? context.activeClubId : payload.clubId

  if (
    requestedClubId &&
    !context.memberships.some((membership) => membership.clubId === requestedClubId && membership.status === 'ACTIVE')
  ) {
    return NextResponse.json({ error: 'Club is not assigned to current user.' }, { status: 403 })
  }

  if (requestedClubId) {
    cookieStore.set(ACTIVE_CLUB_COOKIE, requestedClubId, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
  } else {
    cookieStore.delete(ACTIVE_CLUB_COOKIE)
  }

  const requestedRole = parseRole(payload.role)
  if (payload.role !== undefined && !requestedRole) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
  }

  if (requestedRole) {
    const allowed =
      (requestedRole === Role.CLIENT &&
        context.roles.some((role) => role.role === Role.CLIENT && role.clubId === null)) ||
      context.memberships.some(
        (membership) =>
          membership.clubId === requestedClubId &&
          membership.status === 'ACTIVE' &&
          membership.role === requestedRole,
      )
    if (!allowed) {
      return NextResponse.json({ error: 'Role is not available in selected club.' }, { status: 403 })
    }

    cookieStore.set(ACTIVE_ROLE_COOKIE, requestedRole, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
    cookieStore.set(ACTIVE_MODE_COOKIE, requestedRole === Role.CLIENT ? 'CLIENT' : 'STAFF', {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
  }

  if (payload.activeMode !== undefined) {
    if (payload.activeMode !== 'CLIENT' && payload.activeMode !== 'STAFF') {
      return NextResponse.json({ error: 'Invalid activeMode.' }, { status: 400 })
    }
    if (payload.activeMode === 'STAFF') {
      const hasStaff = context.memberships.some(
        (membership) => membership.status === 'ACTIVE' && membership.role !== Role.CLIENT,
      )
      if (!hasStaff) {
        return NextResponse.json({ error: 'Staff mode is not available for current user.' }, { status: 409 })
      }
    }
    cookieStore.set(ACTIVE_MODE_COOKIE, payload.activeMode, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
    if (payload.activeMode === 'CLIENT') {
      cookieStore.set(ACTIVE_ROLE_COOKIE, Role.CLIENT, {
        path: '/',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      })
    }
  }

  let updated
  try {
    updated = await getCabinetContext()
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  const capabilities = buildCapabilitySnapshot(updated.memberships)

  return NextResponse.json({
    userId: updated.userId,
    roles: updated.roles,
    memberships: updated.memberships,
    defaultClubId: updated.defaultClubId,
    activeClubId: updated.activeClubId,
    activeRole: updated.activeRole,
    activeMode: updated.activeMode,
    defaultMode: updated.defaultMode,
    hasClientPersona: updated.hasClientPersona,
    staffMembershipsCount: updated.staffMembershipsCount,
    clubs: updated.clubs,
    profile: updated.profile,
    capabilities,
    demoAuthEnabled: isDemoAuthEnabled(),
  })
}
