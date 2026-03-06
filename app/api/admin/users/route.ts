import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { adminErrorResponse, parsePage } from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  redactPii,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ)
    const searchParams = request.nextUrl.searchParams
    const q = searchParams.get('q')?.trim()
    const status = searchParams.get('status')?.trim()
    const { page, pageSize, skip } = parsePage(searchParams)

    const where: Record<string, unknown> = {}
    if (q) {
      where.OR = [
        { id: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { name: { contains: q } },
      ]
    }
    if (status) where.status = status

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          memberships: {
            select: { clubId: true, role: true, status: true },
          },
          platformAdminRoles: {
            where: { status: 'ACTIVE' },
            select: { role: true, status: true },
          },
          authSessions: {
            orderBy: { lastSeenAt: 'desc' },
            take: 1,
            select: { lastSeenAt: true },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ])

    return NextResponse.json({
      items: users.map((user) => {
        const pii = redactPii(
          { phone: user.phone, email: user.email },
          admin,
        )
        return {
          userId: user.id,
          name: user.name,
          phone: pii.phone,
          email: pii.email,
          status: user.status,
          platformRoles: user.platformAdminRoles.map((r) => r.role),
          clubMemberships: user.memberships.map((m) => ({
            clubId: m.clubId,
            role: m.role,
            status: m.status,
          })),
          lastLoginAt: user.authSessions[0]?.lastSeenAt ?? null,
          createdAt: user.createdAt,
        }
      }),
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

