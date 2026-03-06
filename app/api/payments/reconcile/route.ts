import { Role } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { CommerceError, reconcilePendingPaymentIntents } from '@/src/lib/commerceService'

export const dynamic = 'force-dynamic'

type Payload = {
  olderThanMinutes?: number
  limit?: number
}

export async function POST(request: NextRequest) {
  let payload: Payload = {}
  try {
    payload = (await request.json()) as Payload
  } catch {
    payload = {}
  }

  const context = await getCabinetContext({ requireSession: true }).catch(() => null)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  if (context.activeRole === Role.CLIENT) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  try {
    const result = await reconcilePendingPaymentIntents({
      olderThanMinutes: payload.olderThanMinutes,
      limit: payload.limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CommerceError) {
      return NextResponse.json(
        { code: error.code, error: error.message, details: error.details || null },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'Failed to reconcile payment intents.' }, { status: 500 })
  }
}
