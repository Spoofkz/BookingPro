import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
  resolveClubContextFromRequest,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string }>
}

type AddNoteBody = {
  text?: string
  isPinned?: boolean
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

  const notes = await prisma.customerNote.findMany({
    where: {
      clubId,
      customerId,
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })

  return NextResponse.json({
    items: notes.map((note) => ({
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

  let body: AddNoteBody
  try {
    body = (await request.json()) as AddNoteBody
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

  const note = await prisma.$transaction(async (tx) => {
    const created = await tx.customerNote.create({
      data: {
        clubId,
        customerId,
        text,
        isPinned: body.isPinned === true,
        createdByUserId: context.userId,
      },
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
        action: 'customer.note_added',
        entityType: 'customer_note',
        entityId: created.id,
        metadata: JSON.stringify({
          customerId,
          isPinned: created.isPinned,
        }),
      },
    })

    return created
  })

  return NextResponse.json(
    {
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
    },
    { status: 201 },
  )
}
