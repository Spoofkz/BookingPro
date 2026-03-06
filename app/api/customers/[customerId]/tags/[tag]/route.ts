import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { normalizeCustomerTag } from '@/src/lib/customerManagement'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string; tag: string }>
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const { customerId, tag: rawTag } = await routeContext.params
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

  const decodedTag = normalizeCustomerTag(rawTag)
  if (!decodedTag) {
    return NextResponse.json({ error: 'tag is invalid.' }, { status: 400 })
  }

  const removed = await prisma.$transaction(async (tx) => {
    const existing = await tx.customerTag.findFirst({
      where: {
        clubId,
        customerId,
        tag: decodedTag,
      },
    })
    if (!existing) return null

    await tx.customerTag.delete({
      where: {
        id: existing.id,
      },
    })

    await tx.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'customer.tag_removed',
        entityType: 'customer_tag',
        entityId: existing.id,
        metadata: JSON.stringify({
          customerId,
          tag: decodedTag,
        }),
      },
    })

    return existing
  })

  if (!removed) {
    return NextResponse.json({ error: 'Tag was not found.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
