import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  loginWithCredentials,
} from '@/src/lib/authSession'

export const dynamic = 'force-dynamic'

type Payload = {
  identifier?: string
  password?: string
}

export async function POST(request: NextRequest) {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload.identifier || !payload.password) {
    return NextResponse.json(
      { error: 'identifier and password are required.' },
      { status: 400 },
    )
  }

  try {
    const result = await loginWithCredentials({
      identifier: payload.identifier,
      password: payload.password,
      ipAddress: getClientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent'),
    })

    const cookieStore = await cookies()
    cookieStore.set(AUTH_SESSION_COOKIE, result.token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
    })

    return NextResponse.json({
      sessionId: result.sessionId,
      userId: result.userId,
      expiresAt: result.expiresAt,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Failed to login user.' }, { status: 400 })
  }
}
