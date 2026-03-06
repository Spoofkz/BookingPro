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

type Body = {
  newPhone?: string | null
  newEmail?: string | null
  otpCode?: string
  revokeOtherSessions?: boolean
}

function normalizeEmail(input: string | null | undefined) {
  if (input === null || input === undefined) return null
  const value = input.trim().toLowerCase()
  if (!value) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return '__INVALID__'
  return value
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const currentPhone = context.profile.phone
    const currentEmail = context.profile.email?.toLowerCase() || null

    const nextPhone =
      body.newPhone === undefined
        ? currentPhone
        : body.newPhone === null || body.newPhone.trim() === ''
          ? null
          : normalizePhone(body.newPhone) || '__INVALID__'
    const nextEmailRaw = body.newEmail === undefined ? currentEmail : normalizeEmail(body.newEmail)

    if (nextPhone === '__INVALID__') {
      return NextResponse.json({ error: 'newPhone is invalid.' }, { status: 400 })
    }
    if (nextEmailRaw === '__INVALID__') {
      return NextResponse.json({ error: 'newEmail is invalid.' }, { status: 400 })
    }

    const nextEmail = nextEmailRaw
    const hasChange = nextPhone !== currentPhone || nextEmail !== currentEmail
    if (!hasChange) {
      return NextResponse.json({
        phone: currentPhone,
        email: currentEmail,
        changed: false,
      })
    }

    if (!body.otpCode?.trim()) {
      return NextResponse.json(
        { code: 'STEP_UP_REQUIRED', error: 'otpCode is required for identity change.' },
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

    const updated = await prisma.user.update({
      where: { id: context.userId },
      data: {
        phone: nextPhone === '__INVALID__' ? null : nextPhone,
        email: nextEmail,
      },
      select: {
        phone: true,
        email: true,
      },
    })

    let revokedSessions = 0
    if (body.revokeOtherSessions !== false) {
      const cookieStore = await cookies()
      const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
      const keepSessionId = await getSessionIdByToken(token)
      revokedSessions = await revokeOtherUserSessions({
        userId: context.userId,
        keepSessionId,
        reason: 'identity_change',
      })
    }

    await prisma.auditLog.create({
      data: {
        clubId: context.activeClubId,
        actorUserId: context.userId,
        action: 'user.identity.changed',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          changedPhone: updated.phone !== currentPhone,
          changedEmail: updated.email !== currentEmail,
          revokedSessions,
        }),
      },
    })

    return NextResponse.json({
      changed: true,
      phone: updated.phone,
      email: updated.email,
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
