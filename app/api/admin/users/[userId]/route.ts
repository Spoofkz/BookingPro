import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  redactPii,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(_: Request, routeContext: RouteContext) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ)
    const { userId } = await routeContext.params

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            club: {
              select: { id: true, name: true, slug: true, status: true },
            },
          },
          orderBy: [{ createdAt: 'asc' }],
        },
        platformAdminRoles: true,
        authSessions: {
          orderBy: [{ lastSeenAt: 'desc' }],
          take: 20,
        },
      },
    })
    if (!user) return NextResponse.json({ error: 'User was not found.' }, { status: 404 })

    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { clientUserId: userId },
          ...(user.email ? [{ guestEmail: user.email }] : []),
        ],
      },
      include: {
        club: {
          select: { id: true, name: true, slug: true },
        },
        room: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const userPii = redactPii({ phone: user.phone, email: user.email }, admin)

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        phone: userPii.phone,
        email: userPii.email,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      platformRoles: user.platformAdminRoles.map((role) => ({
        role: role.role,
        status: role.status,
        notes: role.notes,
      })),
      clubs: user.memberships.map((membership) => ({
        membershipId: membership.id,
        clubId: membership.clubId,
        clubName: membership.club.name,
        clubSlug: membership.club.slug,
        clubStatus: membership.club.status,
        role: membership.role,
        status: membership.status,
      })),
      sessions: user.authSessions.map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        ipAddress: session.ipAddress,
      })),
      bookings: bookings.map((booking) => {
        const bookingPii = redactPii(
          { phone: booking.guestPhone, email: booking.guestEmail },
          admin,
        )
        return {
          bookingId: booking.id,
          clubId: booking.clubId,
          clubName: booking.club?.name ?? null,
          roomId: booking.roomId,
          roomName: booking.room.name,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guestName: booking.guestName,
          guestEmail: bookingPii.email,
          guestPhone: bookingPii.phone,
          createdAt: booking.createdAt,
        }
      }),
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

