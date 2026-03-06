import { Role } from '@prisma/client'
import type { NextRequest } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import type { CabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'
import { RescheduleFlowError, type RescheduleMode } from '@/src/lib/rescheduleService'

type BookingAccess = {
  bookingId: number
  clubId: string
  mode: RescheduleMode
}

type IntentAccess = {
  rescheduleId: string
  bookingId: number
  clubId: string
  mode: RescheduleMode
}

function clientOwnsRecord(params: {
  context: CabinetContext
  clientUserId: string | null
  guestEmail: string | null
}) {
  const email = params.context.profile.email?.toLowerCase() || ''
  return params.clientUserId === params.context.userId || (!!email && params.guestEmail === email)
}

function requireStaffReschedulePermission(params: {
  request: NextRequest
  context: CabinetContext
  resourceClubId: string
}) {
  let requestedClubId: string | null = null
  try {
    requestedClubId = resolveClubContextFromRequest(params.request, params.context, {
      required: true,
    })
    if (!requestedClubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    requirePermissionInClub(params.context, requestedClubId, PERMISSIONS.BOOKING_RESCHEDULE)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new RescheduleFlowError(error.code, error.status, error.message)
    }
    throw new RescheduleFlowError('INSUFFICIENT_PERMISSION', 403, 'Forbidden.')
  }

  if (requestedClubId !== params.resourceClubId) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Resource was not found.')
  }
}

export async function resolveBookingRescheduleAccess(params: {
  request: NextRequest
  context: CabinetContext
  bookingId: number
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.bookingId },
    select: {
      id: true,
      clubId: true,
      clientUserId: true,
      guestEmail: true,
    },
  })
  if (!booking) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Booking was not found.')
  }
  if (!booking.clubId) {
    throw new RescheduleFlowError(
      'BOOKING_NOT_RESCHEDULABLE',
      409,
      'Booking is not associated with a club.',
    )
  }

  if (params.context.activeRole === Role.CLIENT) {
    if (
      !clientOwnsRecord({
        context: params.context,
        clientUserId: booking.clientUserId,
        guestEmail: booking.guestEmail,
      })
    ) {
      throw new RescheduleFlowError('INSUFFICIENT_PERMISSION', 403, 'Forbidden.')
    }

    const requestedClubId = params.request.headers.get('x-club-id')?.trim() || null
    if (requestedClubId && requestedClubId !== booking.clubId) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Booking was not found.')
    }

    return {
      bookingId: booking.id,
      clubId: booking.clubId,
      mode: 'CLIENT',
    } satisfies BookingAccess
  }

  requireStaffReschedulePermission({
    request: params.request,
    context: params.context,
    resourceClubId: booking.clubId,
  })
  return {
    bookingId: booking.id,
    clubId: booking.clubId,
    mode: 'STAFF',
  } satisfies BookingAccess
}

export async function resolveIntentRescheduleAccess(params: {
  request: NextRequest
  context: CabinetContext
  rescheduleId: string
}) {
  const intent = await prisma.rescheduleIntent.findUnique({
    where: { id: params.rescheduleId },
    select: {
      id: true,
      bookingId: true,
      clubId: true,
      booking: {
        select: {
          clientUserId: true,
          guestEmail: true,
        },
      },
    },
  })
  if (!intent) {
    throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
  }

  if (params.context.activeRole === Role.CLIENT) {
    if (
      !clientOwnsRecord({
        context: params.context,
        clientUserId: intent.booking.clientUserId,
        guestEmail: intent.booking.guestEmail,
      })
    ) {
      throw new RescheduleFlowError('INSUFFICIENT_PERMISSION', 403, 'Forbidden.')
    }

    const requestedClubId = params.request.headers.get('x-club-id')?.trim() || null
    if (requestedClubId && requestedClubId !== intent.clubId) {
      throw new RescheduleFlowError('NOT_FOUND', 404, 'Reschedule intent was not found.')
    }

    return {
      rescheduleId: intent.id,
      bookingId: intent.bookingId,
      clubId: intent.clubId,
      mode: 'CLIENT',
    } satisfies IntentAccess
  }

  requireStaffReschedulePermission({
    request: params.request,
    context: params.context,
    resourceClubId: intent.clubId,
  })

  return {
    rescheduleId: intent.id,
    bookingId: intent.bookingId,
    clubId: intent.clubId,
    mode: 'STAFF',
  } satisfies IntentAccess
}
