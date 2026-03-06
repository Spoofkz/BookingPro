import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type DiscoveryEventPayload = {
  eventType: string
  clubId?: string
  payload?: Record<string, unknown>
}

const ALLOWED_EVENT_TYPES = new Set([
  'impression',
  'club_opened',
  'book_now_clicked',
  'slot_selected',
  'seat_selected',
  'hold_created',
  'booking_confirmed',
  'filters_changed',
  'search_submitted',
])

export async function POST(request: NextRequest) {
  let body: DiscoveryEventPayload
  try {
    body = (await request.json()) as DiscoveryEventPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const eventType = body.eventType?.trim() || ''
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ error: 'Unsupported eventType.' }, { status: 400 })
  }

  const clubId = body.clubId?.trim() || null
  if (clubId) {
    const club = await prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true },
    })
    if (!club) {
      return NextResponse.json({ error: 'clubId is invalid.' }, { status: 400 })
    }
  }

  await prisma.auditLog.create({
    data: {
      clubId,
      actorUserId: null,
      action: `discovery.${eventType}`,
      entityType: 'discovery',
      entityId: clubId || eventType,
      metadata: JSON.stringify({
        payload: body.payload ?? {},
        userAgent: request.headers.get('user-agent') || null,
        referrer: request.headers.get('referer') || null,
      }),
    },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}

