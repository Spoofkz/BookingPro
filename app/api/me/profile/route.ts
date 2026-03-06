import { Prisma } from '@prisma/client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  getClientIpFromHeaders,
  getSessionIdByToken,
  normalizePhone,
  revokeOtherUserSessions,
  verifyOtpStepUp,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type UpdateProfileBody = {
  name?: string
  phone?: string | null
  email?: string | null
  otpCode?: string
  revokeOtherSessions?: boolean
}

function normalizeEmail(input: string | null | undefined) {
  if (input === null || input === undefined) return undefined
  const value = input.trim().toLowerCase()
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    return NextResponse.json({
      profile: context.profile,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function PATCH(request: NextRequest) {
  let body: UpdateProfileBody
  try {
    body = (await request.json()) as UpdateProfileBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const currentName = context.profile.name || ''
    const currentPhone = context.profile.phone
    const currentEmail = context.profile.email?.toLowerCase() || null

    const nextName =
      body.name === undefined ? currentName : body.name.trim()
    const normalizedPhone =
      body.phone === undefined
        ? currentPhone
        : body.phone === null || body.phone.trim() === ''
          ? null
          : normalizePhone(body.phone) || '__INVALID__'
    const normalizedEmail = normalizeEmail(body.email)

    if (!nextName) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }
    if (normalizedPhone === '__INVALID__') {
      return NextResponse.json({ error: 'phone is invalid.' }, { status: 400 })
    }
    if (body.email !== undefined && normalizedEmail === null && body.email?.trim()) {
      return NextResponse.json({ error: 'email is invalid.' }, { status: 400 })
    }

    const nextPhone = normalizedPhone === '__INVALID__' ? null : normalizedPhone
    const nextEmail = normalizedEmail === undefined ? currentEmail : normalizedEmail
    const sensitiveChanged = nextPhone !== currentPhone || nextEmail !== currentEmail
    const profileChanged = nextName !== currentName || sensitiveChanged

    if (!profileChanged) {
      return NextResponse.json({
        profile: {
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
        name: nextName,
        phone: nextPhone,
        email: nextEmail,
      },
      select: {
        id: true,
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
        reason: 'profile_sensitive_change',
      })
    }

    await prisma.auditLog.create({
      data: {
        clubId: null,
        actorUserId: context.userId,
        action: 'user.profile_updated',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          sensitiveChanged,
          revokedSessions,
        }),
      },
    })

    return NextResponse.json({
      profile: {
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
      },
      changed: true,
      sensitiveChanged,
      revokedSessions,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { code: 'DUPLICATE_CONTACT', error: 'phone or email already exists.' },
        { status: 409 },
      )
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
