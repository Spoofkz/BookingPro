import { NextRequest, NextResponse } from 'next/server'
import { AuthError, getClientIpFromHeaders, verifyOtpStepUp } from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type Body = {
  otpCode?: string
  reason?: string
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
          requestType: 'EXPORT',
          reason: body.reason?.trim() || '',
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
        action: 'client.privacy.export_requested',
        entityType: 'user',
        entityId: context.userId,
        metadata: JSON.stringify({
          requestId: note.id,
        }),
      },
    })

    return NextResponse.json(
      {
        requestId: note.id,
        requestType: 'EXPORT',
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
