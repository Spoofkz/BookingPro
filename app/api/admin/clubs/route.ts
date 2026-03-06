import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, parsePage } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.CLUBS_READ)

    const searchParams = request.nextUrl.searchParams
    const q = searchParams.get('q')?.trim()
    const status = searchParams.get('status')?.trim()
    const city = searchParams.get('city')?.trim()
    const verificationStatus = searchParams.get('verificationStatus')?.trim()
    const onboardingIncomplete = searchParams.get('onboardingIncomplete') === 'true'
    const { page, pageSize, skip } = parsePage(searchParams)

    const where: Record<string, unknown> = {}
    if (q) {
      where.OR = [
        { id: { contains: q } },
        { name: { contains: q } },
        { slug: { contains: q } },
      ]
    }
    if (status) where.status = status
    if (city) where.city = city
    if (verificationStatus) {
      where.verification = { is: { status: verificationStatus } }
    }
    if (onboardingIncomplete) {
      where.OR = [
        ...(Array.isArray(where.OR) ? (where.OR as unknown[]) : []),
        { status: 'DRAFT' },
        { schedulePublishedAt: null },
        { slotsGeneratedUntil: null },
      ]
    }

    const [clubs, total] = await Promise.all([
      prisma.club.findMany({
        where,
        include: {
          verification: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        skip,
        take: pageSize,
      }),
      prisma.club.count({ where }),
    ])

    return NextResponse.json({
      items: clubs.map((club) => ({
        clubId: club.id,
        name: club.name,
        slug: club.slug,
        city: club.city,
        area: club.area,
        status: club.status,
        verificationStatus: club.verification?.status ?? 'UNVERIFIED',
        onboardingReadinessScore:
          club.status === 'PUBLISHED'
            ? 100
            : club.schedulePublishedAt && club.slotsGeneratedUntil
              ? 70
              : 30,
        lastActivityAt: club.updatedAt,
        totalBookings: club._count.bookings,
      })),
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}
