import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  AuthError,
  changePasswordWithCredentials,
  getClientIpFromHeaders,
  getSessionIdByToken,
  revokeOtherUserSessions,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

type Payload = {
  currentPassword?: string
  newPassword?: string
  revokeOtherSessions?: boolean
}

export async function POST(request: NextRequest) {
  let payload: Payload
  try {
    payload = (await request.json()) as Payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!payload.newPassword) {
    return NextResponse.json({ error: 'newPassword is required.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    await changePasswordWithCredentials({
      userId: context.userId,
      currentPassword: payload.currentPassword || null,
      newPassword: payload.newPassword,
      ipAddress: getClientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent'),
    })

    let revokedSessions = 0
    if (payload.revokeOtherSessions) {
      const cookieStore = await cookies()
      const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
      const currentSessionId = await getSessionIdByToken(token)
      revokedSessions = await revokeOtherUserSessions({
        userId: context.userId,
        keepSessionId: currentSessionId,
        reason: 'password_change',
      })
    }

    return NextResponse.json({ ok: true, revokedSessions })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
