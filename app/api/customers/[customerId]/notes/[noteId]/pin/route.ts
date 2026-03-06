import { NextRequest, NextResponse } from 'next/server'
import { Role } from '@prisma/client'
import {
  AuthorizationError,
  requireClubMembership,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string; noteId: string }>
}

type PinBody = {
  isPinned?: boolean
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { customerId, noteId } = await routeContext.params
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
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: PinBody = {}
  try {
    body = (await request.json()) as PinBody
  } catch {
    body = {}
  }
  const isPinned = body.isPinned !== false

  let note:
    | {
        id: string
        text: string
        isPinned: boolean
        createdAt: Date
        updatedAt: Date
        createdByUser: {
          id: string
          name: string
        } | null
      }
    | null
  try {
    note = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerNote.findFirst({
        where: {
          id: noteId,
          customerId,
          clubId,
        },
      })
      if (!existing) return null
      const canManageAnyNote = clubRoles.includes(Role.TECH_ADMIN)
      if (!canManageAnyNote && existing.createdByUserId !== context.userId) {
        throw new AuthorizationError(
          'INSUFFICIENT_PERMISSION',
          'Hosts can pin only their own notes.',
          403,
        )
      }

      const updated = await tx.customerNote.update({
        where: { id: existing.id },
        data: { isPinned },
        include: {
          createdByUser: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: isPinned ? 'customer.note_pinned' : 'customer.note_unpinned',
          entityType: 'customer_note',
          entityId: updated.id,
          metadata: JSON.stringify({
            customerId,
            isPinned,
          }),
        },
      })

      return updated
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    throw error
  }

  if (!note) {
    return NextResponse.json({ error: 'Note was not found.' }, { status: 404 })
  }

  return NextResponse.json({
    noteId: note.id,
    text: note.text,
    isPinned: note.isPinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    createdBy: note.createdByUser
      ? {
          id: note.createdByUser.id,
          name: note.createdByUser.name,
        }
      : null,
  })
}
