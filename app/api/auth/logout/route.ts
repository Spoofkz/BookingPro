import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE, revokeSessionByToken } from '@/src/lib/authSession'

export const dynamic = 'force-dynamic'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
  await revokeSessionByToken(token, 'logout')
  cookieStore.delete(AUTH_SESSION_COOKIE)
  return NextResponse.json({ ok: true })
}
