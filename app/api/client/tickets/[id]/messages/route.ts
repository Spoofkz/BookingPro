import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

type Body = {
  text?: string
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const ticketId = id.trim()
  if (!ticketId) {
    return NextResponse.json({ error: 'Invalid ticket id.' }, { status: 400 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const text = body.text?.trim() || ''
  if (!text) {
    return NextResponse.json({ error: 'text is required.' }, { status: 400 })
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: 'text is too long.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const ticket = await prisma.dispute.findFirst({
      where: {
        id: ticketId,
        customerUserId: context.userId,
      },
      select: {
        id: true,
        clubId: true,
      },
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
    }

    const message = await prisma.platformNote.create({
      data: {
        entityType: 'DISPUTE_MESSAGE',
        entityId: ticket.id,
        clubId: ticket.clubId,
        text,
        createdByUserId: context.userId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    })

    await prisma.auditLog.create({
      data: {
        clubId: ticket.clubId,
        actorUserId: context.userId,
        action: 'client.ticket.message_added',
        entityType: 'dispute',
        entityId: ticket.id,
        metadata: JSON.stringify({ messageId: message.id }),
      },
    })

    return NextResponse.json(
      {
        messageId: message.id,
        ticketId: ticket.id,
        text,
        createdAt: message.createdAt,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
