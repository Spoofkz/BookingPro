import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  revokeAllUserSessions,
  revokeSessionByToken,
} from '@/src/lib/authSession'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

export async function POST() {
  const cookieStore = await cookies()
  const currentToken = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
  if (!currentToken) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const context = await getCabinetContext()
    await revokeAllUserSessions(context.userId, 'logout_all')
    await revokeSessionByToken(currentToken, 'logout_all')
  } catch {
    await revokeSessionByToken(currentToken, 'logout_all')
  }

  cookieStore.delete(AUTH_SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}
