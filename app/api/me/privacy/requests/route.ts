import { NextRequest, NextResponse } from 'next/server'
import { AuthError, getClientIpFromHeaders, verifyOtpStepUp } from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RequestType = 'EXPORT' | 'ANONYMIZE'

type CreatePrivacyRequestBody = {
  requestType?: RequestType
  reason?: string
  otpCode?: string
}

function parseRequestType(input: unknown): RequestType | null {
  if (input === 'EXPORT') return 'EXPORT'
  if (input === 'ANONYMIZE') return 'ANONYMIZE'
  return null
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const notes = await prisma.platformNote.findMany({
      where: {
        entityType: 'PRIVACY_REQUEST',
        entityId: context.userId,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    })

    return NextResponse.json({
      items: notes.map((note) => ({
        requestId: note.id,
        createdAt: note.createdAt,
        text: note.text,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  let body: CreatePrivacyRequestBody
  try {
    body = (await request.json()) as CreatePrivacyRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const requestType = parseRequestType(body.requestType)
  if (!requestType) {
    return NextResponse.json(
      { error: 'requestType must be EXPORT or ANONYMIZE.' },
      { status: 400 },
    )
  }

  const reason = body.reason?.trim() || ''
  if (reason.length > 1000) {
    return NextResponse.json({ error: 'reason is too long.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    if (!context.profile.phone) {
      return NextResponse.json(
        { code: 'STEP_UP_UNAVAILABLE', error: 'Verified phone is required for privacy requests.' },
        { status: 409 },
      )
    }
    if (!body.otpCode?.trim()) {
      return NextResponse.json(
        { code: 'STEP_UP_REQUIRED', error: 'otpCode is required.' },
        { status: 409 },
      )
    }

    await verifyOtpStepUp({
      phone: context.profile.phone,
      code: body.otpCode.trim(),
      actorUserId: context.userId,
      ipAddress: getClientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent'),
    })

    const note = await prisma.platformNote.create({
      data: {
        entityType: 'PRIVACY_REQUEST',
        entityId: context.userId,
        clubId: context.activeClubId,
        text: JSON.stringify({
          requestType,
          reason,
          status: 'REQUESTED',
        }),
        createdByUserId: context.userId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    })

    await prisma.auditLog.create({
      data: {
        clubId: context.activeClubId,
        actorUserId: context.userId,
        action: 'privacy.request.created',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          requestType,
          requestId: note.id,
        }),
      },
    })

    return NextResponse.json(
      {
        requestId: note.id,
        requestType,
        status: 'REQUESTED',
        createdAt: note.createdAt,
      },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
