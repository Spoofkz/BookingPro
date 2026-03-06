import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
    const skip = (page - 1) * pageSize

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
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              checkIn: true,
              checkOut: true,
              paymentStatus: true,
              room: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.payment.count({ where }),
    ])

    return NextResponse.json({ items, page, pageSize, total })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
