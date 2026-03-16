import { MembershipStatus, Role } from '@prisma/client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  registerWithCredentials,
} from '@/src/lib/authSession'
import {
  ACTIVE_CLUB_COOKIE,
  ACTIVE_MODE_COOKIE,
  ACTIVE_ROLE_COOKIE,
  DEMO_USER_COOKIE,
} from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

const CONTEXT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

async function applyDefaultModeCookies(cookieStore: Awaited<ReturnType<typeof cookies>>, userId: string) {
  const activeStaffMembership = await prisma.clubMembership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      role: { not: Role.CLIENT },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      clubId: true,
    },
  })

  if (activeStaffMembership) {
    cookieStore.set(ACTIVE_MODE_COOKIE, 'STAFF', {
      path: '/',
      sameSite: 'lax',
      maxAge: CONTEXT_COOKIE_MAX_AGE_SECONDS,
    })
    cookieStore.set(ACTIVE_CLUB_COOKIE, activeStaffMembership.clubId, {
      path: '/',
      sameSite: 'lax',
      maxAge: CONTEXT_COOKIE_MAX_AGE_SECONDS,
    })
    cookieStore.delete(ACTIVE_ROLE_COOKIE)
  } else {
    cookieStore.set(ACTIVE_MODE_COOKIE, 'CLIENT', {
      path: '/',
      sameSite: 'lax',
      maxAge: CONTEXT_COOKIE_MAX_AGE_SECONDS,
    })
    cookieStore.set(ACTIVE_ROLE_COOKIE, Role.CLIENT, {
      path: '/',
      sameSite: 'lax',
      maxAge: CONTEXT_COOKIE_MAX_AGE_SECONDS,
    })
    cookieStore.delete(ACTIVE_CLUB_COOKIE)
  }

  cookieStore.delete(DEMO_USER_COOKIE)
}

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
    await applyDefaultModeCookies(cookieStore, result.userId)

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
