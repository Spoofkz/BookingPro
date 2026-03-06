import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { isPrismaUniqueViolation, normalizeCustomerTag } from '@/src/lib/customerManagement'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string }>
}

type AddTagBody = {
  tag?: string
}

async function assertCustomerInClub(clubId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      clubId,
    },
    select: { id: true },
  })
  return customer
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { customerId } = await routeContext.params
  const context = await getCabinetContext()

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
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_READ)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const customer = await assertCustomerInClub(clubId, customerId)
  if (!customer) {
    return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
  }

  const tags = await prisma.customerTag.findMany({
    where: {
      clubId,
      customerId,
    },
    orderBy: [{ createdAt: 'desc' }, { tag: 'asc' }],
  })

  return NextResponse.json({
    items: tags.map((item) => ({
      id: item.id,
      tag: item.tag,
      createdAt: item.createdAt,
    })),
  })
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { customerId } = await routeContext.params
  const context = await getCabinetContext()

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
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_WRITE)
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const customer = await assertCustomerInClub(clubId, customerId)
  if (!customer) {
    return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
  }

  let body: AddTagBody
  try {
    body = (await request.json()) as AddTagBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const tag = normalizeCustomerTag(body.tag)
  if (!tag) {
    return NextResponse.json({ error: 'tag is required.' }, { status: 400 })
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const tagRow = await tx.customerTag.create({
        data: {
          clubId,
          customerId,
          tag,
          createdByUserId: context.userId,
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'customer.tag_added',
          entityType: 'customer_tag',
          entityId: tagRow.id,
          metadata: JSON.stringify({
            customerId,
            tag,
          }),
        },
      })

      return tagRow
    })

    return NextResponse.json(
      {
        id: created.id,
        tag: created.tag,
        createdAt: created.createdAt,
      },
      { status: 201 },
    )
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      const existing = await prisma.customerTag.findFirst({
        where: {
          clubId,
          customerId,
          tag,
        },
      })
      return NextResponse.json(
        {
          id: existing?.id || null,
          tag,
          createdAt: existing?.createdAt || null,
        },
        { status: 200 },
      )
    }
    throw error
  }
}
