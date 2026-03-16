import { NextRequest } from 'next/server'
import { AuthorizationError, requirePermissionInClub } from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import type { Permission } from '@/src/lib/rbac'

export async function requireFinancePermission(params: {
  clubId: string
  permission: Permission
}) {
  const context = await getCabinetContext({ requireSession: true })
  requirePermissionInClub(context, params.clubId, params.permission)
  return context
}

export function parseDateQuery(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function parseTextQuery(value: string | null) {
  const normalized = value?.trim()
  if (!normalized) return null
  return normalized
}

export function jsonAuthError(error: unknown) {
  if (error instanceof AuthorizationError) {
    return {
      status: error.status,
      payload: { code: error.code, error: error.message },
    }
  }
  return {
    status: 401,
    payload: { error: 'Unauthorized.' },
  }
}

export function parseBodyNumber(
  body: Record<string, unknown>,
  key: string,
  fallback = 0,
) {
  const raw = body[key]
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return value
}

export function parseBodyString(body: Record<string, unknown>, key: string) {
  const raw = body[key]
  if (typeof raw !== 'string') return null
  const normalized = raw.trim()
  return normalized || null
}

export function getRangeFromRequest(request: NextRequest) {
  const search = request.nextUrl.searchParams
  return {
    from: parseDateQuery(search.get('from') || search.get('dateFrom')),
    to: parseDateQuery(search.get('to') || search.get('dateTo')),
  }
}
