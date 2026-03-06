import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { readIdempotencyKey } from '@/src/lib/idempotency'

export const dynamic = 'force-dynamic'

type Payload = {
  clubId?: string
  slotId?: string
  seatId?: string
}

export async function POST(request: NextRequest) {
  const idempotencyKey = readIdempotencyKey(request)
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        error: 'Idempotency-Key header is required.',
      },
      { status: 400 },
    )
  }

  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const clubId = payload.clubId?.trim()
  const slotId = payload.slotId?.trim()
  const seatId = payload.seatId?.trim()
  if (!clubId || !slotId || !seatId) {
    return NextResponse.json(
      { error: 'clubId, slotId, and seatId are required.' },
      { status: 400 },
    )
  }

  try {
    await getCabinetContext({ requireSession: true })
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const upstream = await fetch(new URL(`/api/clubs/${clubId}/holds`, request.url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(request.headers.get('cookie')
        ? { cookie: request.headers.get('cookie') as string }
        : {}),
      ...(request.headers.get('idempotency-key')
        ? { 'idempotency-key': request.headers.get('idempotency-key') as string }
        : {}),
    },
    body: JSON.stringify({ slotId, seatId }),
    cache: 'no-store',
  })

  const text = await upstream.text()
  let data: unknown = null
  try {
    data = text ? (JSON.parse(text) as unknown) : null
  } catch {
    data = { error: text || 'Unexpected response from hold service.' }
  }

  return NextResponse.json(data, { status: upstream.status })
}
