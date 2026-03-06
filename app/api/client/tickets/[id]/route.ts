import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const ticketId = id.trim()
  if (!ticketId) {
    return NextResponse.json({ error: 'Invalid ticket id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const ticket = await prisma.dispute.findFirst({
      where: {
        id: ticketId,
        customerUserId: context.userId,
      },
      include: {
        booking: true,
        payment: true,
        club: {
          select: {
            id: true,
            name: true,
            slug: true,
            city: true,
            area: true,
          },
        },
      },
    })
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
    }

    const messages = await prisma.platformNote.findMany({
      where: {
        entityType: 'DISPUTE_MESSAGE',
        entityId: ticket.id,
      },
      orderBy: [{ createdAt: 'asc' }],
    })

    return NextResponse.json({
      ...ticket,
      messages: messages.map((item) => ({
        messageId: item.id,
        text: item.text,
        createdAt: item.createdAt,
        createdByUserId: item.createdByUserId,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
