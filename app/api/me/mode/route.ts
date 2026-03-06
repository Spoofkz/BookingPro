import { Role } from '@prisma/client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { buildCapabilitySnapshot, isDemoAuthEnabled } from '@/src/lib/authSession'
import {
  ACTIVE_MODE_COOKIE,
  ACTIVE_ROLE_COOKIE,
  getCabinetContext,
} from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type Payload = {
  activeMode?: 'CLIENT' | 'STAFF'
}

export async function POST(request: NextRequest) {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const requestedMode = payload.activeMode
  if (requestedMode !== 'CLIENT' && requestedMode !== 'STAFF') {
    return NextResponse.json({ error: 'activeMode must be CLIENT or STAFF.' }, { status: 400 })
  }

  let before
  try {
    before = await getCabinetContext()
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  if (requestedMode === 'STAFF' && before.staffMembershipsCount < 1) {
    return NextResponse.json(
      { code: 'STAFF_MODE_UNAVAILABLE', error: 'Staff mode is not available for current user.' },
      { status: 409 },
    )
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_MODE_COOKIE, requestedMode, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
  if (requestedMode === 'CLIENT') {
    cookieStore.set(ACTIVE_ROLE_COOKIE, Role.CLIENT, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    })
  } else {
    cookieStore.delete(ACTIVE_ROLE_COOKIE)
  }

  const after = await getCabinetContext()
  await prisma.auditLog.create({
    data: {
      clubId: after.activeClubId,
      actorUserId: after.userId,
      action: 'persona.mode.changed',
      entityType: 'user',
      entityId: after.userId,
      metadata: JSON.stringify({
        previousMode: before.activeMode,
        nextMode: after.activeMode,
        previousRole: before.activeRole,
        nextRole: after.activeRole,
      }),
    },
  })

  const capabilities = buildCapabilitySnapshot(after.memberships)
  return NextResponse.json({
    userId: after.userId,
    defaultClubId: after.defaultClubId,
    activeClubId: after.activeClubId,
    activeRole: after.activeRole,
    activeMode: after.activeMode,
    defaultMode: after.defaultMode,
    hasClientPersona: after.hasClientPersona,
    staffMembershipsCount: after.staffMembershipsCount,
    roles: after.roles,
    memberships: after.memberships,
    clubs: after.clubs,
    profile: after.profile,
    capabilities,
    demoAuthEnabled: isDemoAuthEnabled(),
  })
}
