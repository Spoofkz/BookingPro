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

type UpdateNoteBody = {
  text?: string
}

async function resolveWriteContext(request: NextRequest) {
  const context = await getCabinetContext()
  const clubId = resolveClubContextFromRequest(request, context, { required: true })
  if (!clubId) {
    throw new AuthorizationError(
      'CLUB_CONTEXT_REQUIRED',
      'Active club context is required. Set X-Club-Id header.',
      400,
    )
  }
  const clubRoles = requireClubMembership(context, clubId)
  requirePermissionInClub(context, clubId, PERMISSIONS.CUSTOMER_WRITE)
  return { context, clubId, clubRoles }
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { customerId, noteId } = await routeContext.params

  let context: Awaited<ReturnType<typeof getCabinetContext>>
  let clubId: string
  let clubRoles: Role[]
  try {
    const resolved = await resolveWriteContext(request)
    context = resolved.context
    clubId = resolved.clubId
    clubRoles = resolved.clubRoles
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let body: UpdateNoteBody
  try {
    body = (await request.json()) as UpdateNoteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const text = (body.text || '').trim()
  if (!text) {
    return NextResponse.json({ error: 'Note text is required.' }, { status: 400 })
  }
  if (text.length > 1000) {
    return NextResponse.json({ error: 'Note text must be at most 1000 characters.' }, { status: 400 })
  }

  let updated:
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
    updated = await prisma.$transaction(async (tx) => {
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
          'Hosts can edit only their own notes.',
          403,
        )
      }

      const note = await tx.customerNote.update({
        where: { id: existing.id },
        data: { text },
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
          action: 'customer.note_edited',
          entityType: 'customer_note',
          entityId: note.id,
          metadata: JSON.stringify({
            customerId,
          }),
        },
      })

      return note
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    throw error
  }

  if (!updated) {
    return NextResponse.json({ error: 'Note was not found.' }, { status: 404 })
  }

  return NextResponse.json({
    noteId: updated.id,
    text: updated.text,
    isPinned: updated.isPinned,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    createdBy: updated.createdByUser
      ? {
          id: updated.createdByUser.id,
          name: updated.createdByUser.name,
        }
      : null,
  })
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const { customerId, noteId } = await routeContext.params

  let context: Awaited<ReturnType<typeof getCabinetContext>>
  let clubId: string
  let clubRoles: Role[]
  try {
    const resolved = await resolveWriteContext(request)
    context = resolved.context
    clubId = resolved.clubId
    clubRoles = resolved.clubRoles
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  let deleted: string | null
  try {
    deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.customerNote.findFirst({
        where: {
          id: noteId,
          customerId,
          clubId,
        },
        select: {
          id: true,
          createdByUserId: true,
        },
      })
      if (!existing) return null
      const canManageAnyNote = clubRoles.includes(Role.TECH_ADMIN)
      if (!canManageAnyNote && existing.createdByUserId !== context.userId) {
        throw new AuthorizationError(
          'INSUFFICIENT_PERMISSION',
          'Hosts can delete only their own notes.',
          403,
        )
      }

      await tx.customerNote.delete({
        where: { id: existing.id },
      })

      await tx.auditLog.create({
        data: {
          clubId,
          actorUserId: context.userId,
          action: 'customer.note_deleted',
          entityType: 'customer_note',
          entityId: existing.id,
          metadata: JSON.stringify({
            customerId,
          }),
        },
      })

      return existing.id
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    throw error
  }

  if (!deleted) {
    return NextResponse.json({ error: 'Note was not found.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
