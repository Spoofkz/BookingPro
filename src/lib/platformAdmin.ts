import {
  PlatformAdminRole,
  PlatformAdminStatus,
} from '@prisma/client'
import type { CabinetContext } from '@/src/lib/cabinetContext'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const PLATFORM_PERMISSIONS = {
  CLUBS_READ: 'platform:clubs_read',
  CLUBS_MANAGE: 'platform:clubs_manage',
  VERIFY_CLUB: 'platform:verify_club',
  BOOKINGS_READ: 'platform:bookings_read',
  BOOKINGS_MANAGE: 'platform:bookings_manage',
  PAYMENTS_READ: 'platform:payments_read',
  REFUNDS_MANAGE: 'platform:refunds_manage',
  USERS_READ: 'platform:users_read',
  USERS_MANAGE: 'platform:users_manage',
  FEATURED_MANAGE: 'platform:featured_manage',
  PROMOS_MANAGE: 'platform:promos_manage',
  SCENARIOS_READ: 'platform:scenarios_read',
  SCENARIOS_MANAGE: 'platform:scenarios_manage',
  AUDIT_READ: 'platform:audit_read',
  DISPUTES_READ: 'platform:disputes_read',
  DISPUTES_MANAGE: 'platform:disputes_manage',
  PII_UNMASK: 'platform:pii_unmask',
} as const

export type PlatformPermission =
  (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS]

const PLATFORM_ADMIN_PERMISSIONS: PlatformPermission[] = [
  PLATFORM_PERMISSIONS.CLUBS_READ,
  PLATFORM_PERMISSIONS.CLUBS_MANAGE,
  PLATFORM_PERMISSIONS.VERIFY_CLUB,
  PLATFORM_PERMISSIONS.BOOKINGS_READ,
  PLATFORM_PERMISSIONS.BOOKINGS_MANAGE,
  PLATFORM_PERMISSIONS.PAYMENTS_READ,
  PLATFORM_PERMISSIONS.REFUNDS_MANAGE,
  PLATFORM_PERMISSIONS.USERS_READ,
  PLATFORM_PERMISSIONS.USERS_MANAGE,
  PLATFORM_PERMISSIONS.FEATURED_MANAGE,
  PLATFORM_PERMISSIONS.PROMOS_MANAGE,
  PLATFORM_PERMISSIONS.SCENARIOS_READ,
  PLATFORM_PERMISSIONS.SCENARIOS_MANAGE,
  PLATFORM_PERMISSIONS.AUDIT_READ,
  PLATFORM_PERMISSIONS.DISPUTES_READ,
  PLATFORM_PERMISSIONS.DISPUTES_MANAGE,
  PLATFORM_PERMISSIONS.PII_UNMASK,
]

const PLATFORM_SUPPORT_PERMISSIONS: PlatformPermission[] = [
  PLATFORM_PERMISSIONS.CLUBS_READ,
  PLATFORM_PERMISSIONS.BOOKINGS_READ,
  PLATFORM_PERMISSIONS.BOOKINGS_MANAGE,
  PLATFORM_PERMISSIONS.PAYMENTS_READ,
  PLATFORM_PERMISSIONS.REFUNDS_MANAGE,
  PLATFORM_PERMISSIONS.USERS_READ,
  PLATFORM_PERMISSIONS.SCENARIOS_READ,
  PLATFORM_PERMISSIONS.DISPUTES_READ,
  PLATFORM_PERMISSIONS.DISPUTES_MANAGE,
]

const PLATFORM_RISK_PERMISSIONS: PlatformPermission[] = [
  PLATFORM_PERMISSIONS.CLUBS_READ,
  PLATFORM_PERMISSIONS.VERIFY_CLUB,
  PLATFORM_PERMISSIONS.USERS_READ,
  PLATFORM_PERMISSIONS.BOOKINGS_READ,
  PLATFORM_PERMISSIONS.PAYMENTS_READ,
  PLATFORM_PERMISSIONS.SCENARIOS_READ,
  PLATFORM_PERMISSIONS.SCENARIOS_MANAGE,
  PLATFORM_PERMISSIONS.AUDIT_READ,
  PLATFORM_PERMISSIONS.DISPUTES_READ,
  PLATFORM_PERMISSIONS.PII_UNMASK,
]

export class PlatformAuthorizationError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 403) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function platformPermissionsForRole(role: PlatformAdminRole): PlatformPermission[] {
  if (role === PlatformAdminRole.PLATFORM_ADMIN) return PLATFORM_ADMIN_PERMISSIONS
  if (role === PlatformAdminRole.PLATFORM_SUPPORT) return PLATFORM_SUPPORT_PERMISSIONS
  return PLATFORM_RISK_PERMISSIONS
}

export type PlatformAdminContext = {
  cabinet: CabinetContext
  userId: string
  profile: CabinetContext['profile']
  roles: PlatformAdminRole[]
  permissions: PlatformPermission[]
  can(permission: PlatformPermission): boolean
}

function uniqueSorted<T extends string>(values: T[]) {
  return Array.from(new Set(values)).sort() as T[]
}

export async function getPlatformAdminContext(): Promise<PlatformAdminContext> {
  const cabinet = await getCabinetContext()
  const rows = await prisma.platformAdminUser.findMany({
    where: {
      userId: cabinet.userId,
      status: PlatformAdminStatus.ACTIVE,
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: {
      role: true,
    },
  })

  if (rows.length === 0) {
    throw new PlatformAuthorizationError(
      'PLATFORM_FORBIDDEN',
      'Platform admin access is required.',
      403,
    )
  }

  const roles = rows.map((row) => row.role)
  const permissions = uniqueSorted(
    roles.flatMap((role) => platformPermissionsForRole(role)),
  )

  return {
    cabinet,
    userId: cabinet.userId,
    profile: cabinet.profile,
    roles,
    permissions,
    can(permission) {
      return permissions.includes(permission)
    },
  }
}

export async function requirePlatformPermission(permission: PlatformPermission) {
  const context = await getPlatformAdminContext()
  if (!context.can(permission)) {
    throw new PlatformAuthorizationError(
      'PLATFORM_INSUFFICIENT_PERMISSION',
      `Missing permission: ${permission}.`,
      403,
    )
  }
  return context
}

export function assertPlatformPermission(
  context: PlatformAdminContext,
  permission: PlatformPermission,
) {
  if (!context.can(permission)) {
    throw new PlatformAuthorizationError(
      'PLATFORM_INSUFFICIENT_PERMISSION',
      `Missing permission: ${permission}.`,
      403,
    )
  }
}

export function canViewUnmaskedPii(context: PlatformAdminContext) {
  return context.can(PLATFORM_PERMISSIONS.PII_UNMASK)
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/[^\d]/g, '')
  if (digits.length < 4) return '***'
  const last4 = digits.slice(-4)
  const prefix = trimmed.startsWith('+') && digits.length >= 1 ? `+${digits[0]}` : ''
  return `${prefix}***${last4}`
}

export function maskEmail(email: string | null | undefined) {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.indexOf('@')
  if (at <= 0) return '***'
  const local = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const keep = local.slice(0, Math.min(2, local.length))
  return `${keep}***@${domain}`
}

export function redactPii<T extends { phone?: string | null; email?: string | null }>(
  value: T,
  context: PlatformAdminContext,
) {
  if (canViewUnmaskedPii(context)) return value
  return {
    ...value,
    ...(Object.prototype.hasOwnProperty.call(value, 'phone')
      ? { phone: maskPhone(value.phone) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'email')
      ? { email: maskEmail(value.email) }
      : {}),
  }
}
