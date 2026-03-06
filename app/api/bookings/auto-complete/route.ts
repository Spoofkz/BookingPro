import { NextRequest, NextResponse } from 'next/server'
import { completeElapsedBookings } from '@/src/lib/bookingLifecycle'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let clubId: string
  try {
    const resolved = resolveClubContextFromRequest(request, context, { required: true })
    if (!resolved) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    clubId = resolved
    requirePermissionInClub(context, clubId, PERMISSIONS.BOOKING_CHECK_IN)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const updatedCount = await completeElapsedBookings({ clubId })

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: context.userId,
      action: 'booking.auto_completed',
      entityType: 'booking_batch',
      entityId: `${clubId}:${new Date().toISOString()}`,
      metadata: JSON.stringify({ updatedCount }),
    },
  })

  return NextResponse.json({
    clubId,
    updatedCount,
    completedAt: new Date().toISOString(),
  })
}

