import { Prisma } from '@prisma/client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  getSessionIdByToken,
  normalizeLogin,
  normalizePhone,
  revokeOtherUserSessions,
  verifyOtpStepUp,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type UpdateAccountBody = {
  login?: string
  name?: string
  phone?: string | null
  email?: string | null
  otpCode?: string
  revokeOtherSessions?: boolean
}

function normalizeEmailInput(input: string | null | undefined) {
  if (input === undefined) return { value: undefined as string | null | undefined, invalid: false }
  if (input === null) return { value: null as string | null, invalid: false }
  const value = input.trim().toLowerCase()
  if (!value) return { value: null as string | null, invalid: false }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { value: null as string | null, invalid: true }
  }
  return { value, invalid: false }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    return NextResponse.json({
      profile: {
        login: context.profile.login || null,
        name: context.profile.name || '',
        phone: context.profile.phone || null,
        email: context.profile.email || null,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  let body: UpdateAccountBody
  try {
    body = (await request.json()) as UpdateAccountBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const currentLogin = context.profile.login || null
    const currentName = context.profile.name || ''
    const currentPhone = context.profile.phone || null
    const currentEmail = context.profile.email?.toLowerCase() || null

    const nextName = body.name === undefined ? currentName : body.name.trim()
    if (!nextName) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }

    let nextLogin = currentLogin
    if (body.login !== undefined) {
      const normalizedLogin = normalizeLogin(body.login)
      if (!normalizedLogin) {
        return NextResponse.json(
          {
            error:
              'login must be 3-32 chars and contain only letters, numbers, dot, underscore, or hyphen.',
          },
          { status: 400 },
        )
      }
      nextLogin = normalizedLogin
    }

    const normalizedPhone =
      body.phone === undefined
        ? currentPhone
        : body.phone === null || body.phone.trim() === ''
          ? null
          : normalizePhone(body.phone) || '__INVALID__'
    if (normalizedPhone === '__INVALID__') {
      return NextResponse.json({ error: 'phone is invalid.' }, { status: 400 })
    }
    const nextPhone = normalizedPhone === '__INVALID__' ? null : normalizedPhone

    const normalizedEmail = normalizeEmailInput(body.email)
    if (normalizedEmail.invalid) {
      return NextResponse.json({ error: 'email is invalid.' }, { status: 400 })
    }
    const nextEmail = normalizedEmail.value === undefined ? currentEmail : normalizedEmail.value

    const sensitiveChanged = nextPhone !== currentPhone || nextEmail !== currentEmail
    const accountChanged =
      nextLogin !== currentLogin || nextName !== currentName || sensitiveChanged

    if (!accountChanged) {
      return NextResponse.json({
        profile: {
          login: currentLogin,
          name: currentName,
          phone: currentPhone,
          email: currentEmail,
        },
        changed: false,
      })
    }

    if (sensitiveChanged) {
      if (!body.otpCode?.trim()) {
        return NextResponse.json(
          { code: 'STEP_UP_REQUIRED', error: 'otpCode is required to change phone/email.' },
          { status: 409 },
        )
      }
      if (!currentPhone) {
        return NextResponse.json(
          { code: 'STEP_UP_UNAVAILABLE', error: 'Current account has no verified phone for step-up.' },
          { status: 409 },
        )
      }

      await verifyOtpStepUp({
        phone: currentPhone,
        code: body.otpCode.trim(),
        actorUserId: context.userId,
        ipAddress: getClientIpFromHeaders(request.headers),
        userAgent: request.headers.get('user-agent'),
      })
    }

    const updated = await prisma.user.update({
      where: { id: context.userId },
      data: {
        login: nextLogin,
        name: nextName,
        phone: nextPhone,
        email: nextEmail,
      },
      select: {
        id: true,
        login: true,
        name: true,
        phone: true,
        email: true,
      },
    })

    let revokedSessions = 0
    if (sensitiveChanged && body.revokeOtherSessions !== false) {
      const cookieStore = await cookies()
      const sessionToken = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
      const keepSessionId = await getSessionIdByToken(sessionToken)
      revokedSessions = await revokeOtherUserSessions({
        userId: context.userId,
        keepSessionId,
        reason: 'account_sensitive_change',
      })
    }

    await prisma.auditLog.create({
      data: {
        clubId: context.activeClubId,
        actorUserId: context.userId,
        action: 'user.account_updated',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          sensitiveChanged,
          revokedSessions,
          loginChanged: currentLogin !== updated.login,
        }),
      },
    })

    return NextResponse.json({
      profile: {
        login: updated.login || null,
        name: updated.name || '',
        phone: updated.phone || null,
        email: updated.email || null,
      },
      changed: true,
      sensitiveChanged,
      revokedSessions,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { code: 'DUPLICATE_CONTACT', error: 'login, phone, or email already exists.' },
        { status: 409 },
      )
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
