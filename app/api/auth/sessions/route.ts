import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  getSessionIdByToken,
  listUserSessions,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

function maskIpAddress(ipAddress: string | null) {
  if (!ipAddress) return null
  if (ipAddress.includes('.')) {
    const parts = ipAddress.split('.')
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.***.***`
  }
  if (ipAddress.includes(':')) {
    const parts = ipAddress.split(':')
    return `${parts.slice(0, 2).join(':')}:****`
  }
  return '***'
}

export async function GET() {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const cookieStore = await cookies()
    const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
    const currentSessionId = await getSessionIdByToken(token)
    const sessions = await listUserSessions(context.userId)

    return NextResponse.json({
      items: sessions.map((session) => ({
        sessionId: session.id,
        deviceName: session.userAgent || 'Unknown device',
        ipAddress: maskIpAddress(session.ipAddress),
        lastSeenAt: session.lastSeenAt,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        isCurrent: currentSessionId === session.id,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
