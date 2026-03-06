import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  loginWithCredentials,
} from '@/src/lib/authSession'

export const dynamic = 'force-dynamic'

function redirectWithMessage(request: NextRequest, type: 'error' | 'success', message: string) {
  const url = new URL('/auth/client/basic', request.url)
  url.searchParams.set(type, message)
  return NextResponse.redirect(url)
}

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const identifier = String(formData.get('identifier') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!identifier || !password) {
    return redirectWithMessage(request, 'error', 'Identifier and password are required.')
  }

  try {
    const result = await loginWithCredentials({
      identifier,
      password,
      ipAddress: getClientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent'),
    })

    const response = NextResponse.redirect(new URL('/me/profile', request.url))
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
    })
    return response
  } catch (error) {
    if (error instanceof AuthError) {
      return redirectWithMessage(request, 'error', error.message)
    }
    return redirectWithMessage(request, 'error', 'Failed to login user.')
  }
}
