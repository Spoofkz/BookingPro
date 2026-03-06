import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await getCabinetContext()
  const searchParams = request.nextUrl.searchParams
  const requestedScope = searchParams.get('scope')
  const scope = requestedScope === 'my' ? 'my' : 'club'

  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
  const skip = (page - 1) * pageSize

  if (scope === 'my' || context.activeRole === Role.CLIENT) {
    const where: {
      booking?: {
        OR: Array<Record<string, string>>
      }
    } = {
      booking: {
        OR: [{ clientUserId: context.userId }],
      },
    }

    if (context.profile.email) {
      where.booking?.OR.push({ guestEmail: context.profile.email.toLowerCase() })
    }

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.payment.count({ where }),
    ])

    return NextResponse.json({ items, page, pageSize, total })
  }

  let clubId: string | null = null
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    requirePermissionInClub(context, clubId, PERMISSIONS.CLUB_READ)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.payment.count({ where: { clubId } }),
  ])

  return NextResponse.json({ items, page, pageSize, total })
}
