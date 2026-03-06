import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  getSessionIdByToken,
  revokeSessionByIdForUser,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function POST(_: Request, routeContext: RouteContext) {
  const { sessionId } = await routeContext.params
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return NextResponse.json({ error: 'Invalid session id.' }, { status: 400 })
  }

  try {
    const context = await getCabinetContext({ requireSession: true })
    const cookieStore = await cookies()
    const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
    const currentSessionId = await getSessionIdByToken(token)
    const revoked = await revokeSessionByIdForUser({
      userId: context.userId,
      sessionId: normalizedSessionId,
      reason: 'client_device_revoke',
    })

    if (!revoked) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    }

    if (currentSessionId === normalizedSessionId) {
      cookieStore.delete(AUTH_SESSION_COOKIE)
    }

    return NextResponse.json({ ok: true, revokedSessionId: normalizedSessionId })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
