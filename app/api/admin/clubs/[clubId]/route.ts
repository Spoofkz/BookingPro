import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.CLUBS_READ)
    const { clubId } = await routeContext.params

    const club = await prisma.club.findUnique({
      where: { id: clubId },
      include: {
        verification: {
          include: {
            reviewedBy: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        _count: {
          select: {
            bookings: true,
            payments: true,
            memberships: true,
            customers: true,
          },
        },
      },
    })
    if (!club) {
      return NextResponse.json({ error: 'Club was not found.' }, { status: 404 })
    }

    const recentAudit = await prisma.auditLog.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        actor: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    return NextResponse.json({
      club: {
        id: club.id,
        name: club.name,
        slug: club.slug,
        status: club.status,
        city: club.city,
        area: club.area,
        timezone: club.timezone,
        currency: club.currency,
        address: club.address,
        description: club.description,
        contactsJson: club.contactsJson,
        pauseReason: club.pauseReason,
        pauseUntil: club.pauseUntil,
        publishedAt: club.publishedAt,
        createdAt: club.createdAt,
        updatedAt: club.updatedAt,
      },
      verification: club.verification
        ? {
            status: club.verification.status,
            submittedAt: club.verification.submittedAt,
            reviewedAt: club.verification.reviewedAt,
            notes: club.verification.notes,
            documentsJson: club.verification.documentsJson,
            reviewedBy: club.verification.reviewedBy,
          }
        : {
            status: 'UNVERIFIED',
          },
      counts: club._count,
      recentAudit: recentAudit.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        metadata: item.metadata,
        actor: item.actor,
      })),
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

