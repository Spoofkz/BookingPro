import { CustomerRecordStatus, Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requireClubMembership,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { isPrismaUniqueViolation, normalizeAttentionReason } from '@/src/lib/customerManagement'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type MergeBody = {
  primaryCustomerId?: string
  mergedCustomerId?: string
  reason?: string | null
}

function normalizeId(value: string | null | undefined) {
  const next = (value || '').trim()
  return next || null
}

export async function POST(request: NextRequest) {
  const context = await getCabinetContext()

  let clubId: string | null = null
  let clubRoles: Role[] = []
  try {
    clubId = resolveClubContextFromRequest(request, context, { required: true })
    if (!clubId) {
      throw new AuthorizationError(
        'CLUB_CONTEXT_REQUIRED',
        'Active club context is required. Set X-Club-Id header.',
        400,
      )
    }
    clubRoles = requireClubMembership(context, clubId)
    requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_WRITE)
    if (!clubRoles.includes(Role.TECH_ADMIN)) {
      throw new AuthorizationError(
        'INSUFFICIENT_PERMISSION',
        'Only Technical Admin can merge customers.',
        403,
      )
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: MergeBody
  try {
    body = (await request.json()) as MergeBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const primaryCustomerId = normalizeId(body.primaryCustomerId)
  const mergedCustomerId = normalizeId(body.mergedCustomerId)
  const reason = normalizeAttentionReason(body.reason)

  if (!primaryCustomerId || !mergedCustomerId) {
    return NextResponse.json(
      { error: 'primaryCustomerId and mergedCustomerId are required.' },
      { status: 400 },
    )
  }
  if (primaryCustomerId === mergedCustomerId) {
    return NextResponse.json({ error: 'Customers must be different.' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [primary, secondary] = await Promise.all([
        tx.customer.findFirst({
          where: {
            id: primaryCustomerId,
            clubId,
            status: { not: CustomerRecordStatus.DELETED },
          },
        }),
        tx.customer.findFirst({
          where: {
            id: mergedCustomerId,
            clubId,
            status: { not: CustomerRecordStatus.DELETED },
          },
        }),
      ])

      if (!primary || !secondary) {
        return null
      }
      if (secondary.status === CustomerRecordStatus.MERGED) {
        throw new Error('Merged customer is already archived.')
      }

      const [bookingsMoved, notesMoved, entitlementsMoved, membershipTxMoved, promoRedemptionsMoved, secondaryTags] =
        await Promise.all([
          tx.booking.updateMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            data: { customerId: primary.id },
          }),
          tx.customerNote.updateMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            data: { customerId: primary.id },
          }),
          tx.membershipEntitlement.updateMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            data: { customerId: primary.id },
          }),
          tx.membershipTransaction.updateMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            data: { customerId: primary.id },
          }),
          tx.promoRedemption.updateMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            data: { customerId: primary.id },
          }),
          tx.customerTag.findMany({
            where: {
              clubId,
              customerId: secondary.id,
            },
            select: {
              tag: true,
            },
          }),
        ])

      for (const row of secondaryTags) {
        try {
          await tx.customerTag.create({
            data: {
              clubId,
              customerId: primary.id,
              tag: row.tag,
              createdByUserId: context.userId,
            },
          })
        } catch (error) {
          if (!isPrismaUniqueViolation(error)) {
            throw error
          }
        }
      }

      await tx.customerTag.deleteMany({
        where: {
          clubId,
          customerId: secondary.id,
        },
      })

      const primaryPatch: {
        displayName?: string | null
        phone?: string | null
        email?: string | null
      } = {}
      if (!primary.displayName && secondary.displayName) primaryPatch.displayName = secondary.displayName
      if (!primary.phone && secondary.phone) primaryPatch.phone = secondary.phone
      if (!primary.email && secondary.email) primaryPatch.email = secondary.email
      if (Object.keys(primaryPatch).length > 0) {
        await tx.customer.update({
          where: { id: primary.id },
          data: primaryPatch,
        })
      }

      await tx.customer.update({
        where: { id: secondary.id },
        data: {
          status: CustomerRecordStatus.MERGED,
          displayName: secondary.displayName || `Merged:${secondary.id}`,
          phone: null,
          email: null,
          linkedUserId: null,
          isBlocked: false,
          blockedAt: null,
          blockedByUserId: null,
          requiresAttention: false,
          attentionReason: null,
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'customer.merged',
          entityType: 'customer',
          entityId: primary.id,
          metadata: JSON.stringify({
            primaryCustomerId: primary.id,
            mergedCustomerId: secondary.id,
            reason,
            moved: {
              bookings: bookingsMoved.count,
              notes: notesMoved.count,
              membershipEntitlements: entitlementsMoved.count,
              membershipTransactions: membershipTxMoved.count,
              promoRedemptions: promoRedemptionsMoved.count,
              tags: secondaryTags.length,
            },
          }),
        },
      })

      return {
        primaryCustomerId: primary.id,
        mergedCustomerId: secondary.id,
        moved: {
          bookings: bookingsMoved.count,
          notes: notesMoved.count,
          membershipEntitlements: entitlementsMoved.count,
          membershipTransactions: membershipTxMoved.count,
          promoRedemptions: promoRedemptionsMoved.count,
          tags: secondaryTags.length,
        },
      }
    })

    if (!result) {
      return NextResponse.json({ error: 'Customer was not found.' }, { status: 404 })
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to merge customers.',
      },
      { status: 400 },
    )
  }
}
