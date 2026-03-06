import { DisputeStatus, DisputeType } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import {
  adminErrorResponse,
  asTrimmedString,
  createPlatformAuditLog,
  parsePage,
} from '@/src/lib/platformAdminApi'
import {
  PLATFORM_PERMISSIONS,
  requirePlatformPermission,
} from '@/src/lib/platformAdmin'

export const dynamic = 'force-dynamic'

function parseDisputeType(value: string | null) {
  if (!value) return null
  if (value === DisputeType.BOOKING_ISSUE) return value
  if (value === DisputeType.PAYMENT_ISSUE) return value
  if (value === DisputeType.MISCONDUCT) return value
  if (value === DisputeType.FRAUD_SUSPECTED) return value
  return null
}

function parseDisputeStatus(value: string | null) {
  if (!value) return null
  if (value === DisputeStatus.OPEN) return value
  if (value === DisputeStatus.IN_REVIEW) return value
  if (value === DisputeStatus.RESOLVED) return value
  if (value === DisputeStatus.REJECTED) return value
  return null
}

export async function GET(request: NextRequest) {
  try {
    await requirePlatformPermission(PLATFORM_PERMISSIONS.DISPUTES_READ)
    const searchParams = request.nextUrl.searchParams
    const clubId = searchParams.get('clubId')?.trim()
    const status = parseDisputeStatus(searchParams.get('status'))
    const type = parseDisputeType(searchParams.get('type'))
    const q = searchParams.get('q')?.trim()
    const { page, pageSize, skip } = parsePage(searchParams)

    const where: Record<string, unknown> = {}
    if (clubId) where.clubId = clubId
    if (status) where.status = status
    if (type) where.type = type
    if (q) {
      where.OR = [
        { id: { contains: q } },
        { subject: { contains: q } },
        { description: { contains: q } },
      ]
    }

    const [items, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: {
          club: { select: { id: true, name: true, slug: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.dispute.count({ where }),
    ])

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
    })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requirePlatformPermission(PLATFORM_PERMISSIONS.DISPUTES_MANAGE)
    let payload: Record<string, unknown>
    try {
      payload = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
    }

    const type = parseDisputeType(asTrimmedString(payload.type))
    if (!type) return NextResponse.json({ error: 'type is invalid.' }, { status: 400 })

    const clubId = asTrimmedString(payload.clubId)
    const bookingId =
      typeof payload.bookingId === 'number'
        ? payload.bookingId
        : typeof payload.bookingId === 'string' && payload.bookingId.trim()
          ? Number(payload.bookingId)
          : null
    const paymentId =
      typeof payload.paymentId === 'number'
        ? payload.paymentId
        : typeof payload.paymentId === 'string' && payload.paymentId.trim()
          ? Number(payload.paymentId)
          : null
    const customerUserId = asTrimmedString(payload.customerUserId)
    const subject = asTrimmedString(payload.subject)?.slice(0, 200) ?? null
    const description = asTrimmedString(payload.description)?.slice(0, 5000) ?? null

    if (!clubId && !bookingId && !paymentId && !customerUserId) {
      return NextResponse.json(
        { error: 'At least one of clubId, bookingId, paymentId, customerUserId is required.' },
        { status: 400 },
      )
    }

    const created = await prisma.dispute.create({
      data: {
        clubId,
        bookingId: Number.isInteger(bookingId) ? bookingId : null,
        paymentId: Number.isInteger(paymentId) ? paymentId : null,
        customerUserId,
        type,
        status: DisputeStatus.OPEN,
        subject,
        description,
        createdByUserId: admin.userId,
        assignedToUserId: admin.userId,
      },
    })

    await createPlatformAuditLog({
      actorUserId: admin.userId,
      clubId: created.clubId,
      bookingId: created.bookingId,
      action: 'platform.dispute.created',
      entityType: 'dispute',
      entityId: created.id,
      metadata: {
        type: created.type,
        status: created.status,
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return adminErrorResponse(error)
  }
}

