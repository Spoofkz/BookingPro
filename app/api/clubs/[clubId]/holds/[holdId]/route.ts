import { HoldPurpose, HoldStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { invalidateAvailabilityCacheForClubSlot } from '@/src/lib/availabilityCache'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { canAccessClub } from '@/src/lib/clubAccess'
import { DEMO_USER_COOKIE, getCabinetContext } from '@/src/lib/cabinetContext'
import { PERMISSIONS } from '@/src/lib/rbac'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; holdId: string }>
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const { clubId, holdId } = await routeContext.params
  const context = await getCabinetContext().catch(() => null)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }
  const hasDemoIdentity = Boolean(request.cookies.get(DEMO_USER_COOKIE)?.value)
  if (context.authMethod !== 'session' && (context.activeRole === Role.CLIENT || !hasDemoIdentity)) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const hold = await prisma.hold.findFirst({
    where: {
      id: holdId,
      clubId,
      purpose: HoldPurpose.BOOKING,
    },
    select: {
      id: true,
      clubId: true,
      slotId: true,
      seatId: true,
      ownerUserId: true,
      status: true,
      expiresAtUtc: true,
    },
  })
  if (!hold) {
    return NextResponse.json({ error: 'Hold was not found.' }, { status: 404 })
  }

  const isOwner = hold.ownerUserId === context.userId
  const isStaffMember = canAccessClub(context, clubId) && context.activeRole !== Role.CLIENT
  if (!isOwner) {
    if (!isStaffMember) {
      return NextResponse.json({ error: 'Hold was not found.' }, { status: 404 })
    }
    try {
      requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_CANCEL)
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
      }
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  } else if (context.activeRole !== Role.CLIENT && isStaffMember) {
    // Staff owners are allowed through ownership.
  }

  if (hold.status !== HoldStatus.ACTIVE) {
    return NextResponse.json({
      holdId: hold.id,
      slotId: hold.slotId,
      seatId: hold.seatId,
      status: hold.status,
      expiresAt: hold.expiresAtUtc,
    })
  }

  const canceledAtUtc = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.hold.update({
      where: { id: hold.id },
      data: {
        status: HoldStatus.CANCELED,
        canceledAtUtc,
        canceledByUserId: context.userId,
      },
      select: {
        id: true,
        slotId: true,
        seatId: true,
        status: true,
        expiresAtUtc: true,
        canceledAtUtc: true,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'hold.canceled',
        entityType: 'hold',
        entityId: hold.id,
        metadata: JSON.stringify({
          slotId: hold.slotId,
          seatId: hold.seatId,
          canceledAtUtc: canceledAtUtc.toISOString(),
        }),
      },
    })

    return result
  })

  invalidateAvailabilityCacheForClubSlot(clubId, hold.slotId)

  return NextResponse.json({
    holdId: updated.id,
    slotId: updated.slotId,
    seatId: updated.seatId,
    status: updated.status,
    expiresAt: updated.expiresAtUtc,
    canceledAt: updated.canceledAtUtc,
  })
}
