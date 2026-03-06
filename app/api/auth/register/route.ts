import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  registerWithCredentials,
} from '@/src/lib/authSession'

export const dynamic = 'force-dynamic'

type Payload = {
  login?: string
  email?: string
  phone?: string
  password?: string
}

export async function POST(request: NextRequest) {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload.login || !payload.email || !payload.phone || !payload.password) {
    return NextResponse.json(
      { error: 'login, email, phone, and password are required.' },
      { status: 400 },
    )
  }

  try {
    const result = await registerWithCredentials({
      login: payload.login,
      email: payload.email,
      phone: payload.phone,
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
      login: result.login,
      email: result.email,
      phone: result.phone,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    const fallbackMessage = 'Failed to register user.'
    const isProd = process.env.NODE_ENV === 'production'
    const details =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
          }
        : { message: String(error) }
    return NextResponse.json(
      isProd ? { error: fallbackMessage } : { error: fallbackMessage, details },
      { status: 400 },
    )
  }
}
