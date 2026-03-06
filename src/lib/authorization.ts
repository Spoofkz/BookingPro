import { Role } from '@prisma/client'
import type { NextRequest } from 'next/server'
import type { CabinetContext } from '@/src/lib/cabinetContext'
import { permissionsForRole, type Permission } from '@/src/lib/rbac'

export class AuthorizationError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function resolveClubContextFromRequest(
  request: NextRequest | Request,
  context: CabinetContext,
  options?: { required?: boolean },
) {
  const required = options?.required ?? true
  const headerClubId = request.headers.get('x-club-id')?.trim() || null
  const clubId = headerClubId || context.activeClubId

  if (!clubId && required) {
    throw new AuthorizationError(
      'CLUB_CONTEXT_REQUIRED',
      'Active club context is required. Set X-Club-Id header.',
      400,
    )
  }

  return clubId
}

export function requireClubMembership(context: CabinetContext, clubId: string) {
  const membershipRoles = context.memberships
    .filter((membership) => membership.clubId === clubId && membership.status === 'ACTIVE')
    .map((membership) => membership.role)

  if (membershipRoles.length === 0) {
    throw new AuthorizationError('NOT_A_MEMBER', 'User is not an active member of this club.', 403)
  }

  return membershipRoles
}

export function requirePermissionInClub(
  context: CabinetContext,
  clubId: string,
  permission: Permission,
) {
  const roles = requireClubMembership(context, clubId)
  const allowed = roles.some((role: Role) => permissionsForRole(role).includes(permission))
  if (!allowed) {
    throw new AuthorizationError(
      'INSUFFICIENT_PERMISSION',
      `Missing permission: ${permission}.`,
      403,
    )
  }
}
