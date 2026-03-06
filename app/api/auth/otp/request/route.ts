import { NextRequest, NextResponse } from 'next/server'
import { AuthError, getClientIpFromHeaders, requestOtpCode } from '@/src/lib/authSession'

export const dynamic = 'force-dynamic'

type Payload = {
  phone?: string
}

export async function POST(request: NextRequest) {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload.phone) {
    return NextResponse.json({ error: 'phone is required.' }, { status: 400 })
  }

  try {
    const result = await requestOtpCode({
      phone: payload.phone,
      ipAddress: getClientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({
      phone: result.phone,
      expiresAt: result.expiresAt,
      ...(process.env.NODE_ENV !== 'production' && result.devCode
        ? { devCode: result.devCode }
        : {}),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to request OTP.' }, { status: 400 })
  }
}
