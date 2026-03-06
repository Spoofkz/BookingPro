import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type PrivacyRequestPayload = {
  requestType?: string
  reason?: string
  status?: string
}

function parsePrivacyRequest(text: string) {
  try {
    const parsed = JSON.parse(text) as PrivacyRequestPayload
    return {
      requestType: parsed.requestType || 'UNKNOWN',
      reason: parsed.reason || '',
      status: parsed.status || 'REQUESTED',
    }
  } catch {
    return {
      requestType: 'UNKNOWN',
      reason: text,
      status: 'REQUESTED',
    }
  }
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const requests = await prisma.platformNote.findMany({
      where: {
        entityType: 'PRIVACY_REQUEST',
        entityId: context.userId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })

    return NextResponse.json({
      items: requests.map((item) => ({
        requestId: item.id,
        createdAt: item.createdAt,
        ...parsePrivacyRequest(item.text),
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
