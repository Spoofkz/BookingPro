import { Role } from '@prisma/client'
import type { CabinetContext } from '@/src/lib/cabinetContext'

export function canAccessClub(context: CabinetContext, clubId: string) {
  return context.clubs.some((club) => club.id === clubId)
}

export function canManageClubAsTechAdmin(context: CabinetContext, clubId: string) {
  return context.roles.some((role) => role.clubId === clubId && role.role === Role.TECH_ADMIN)
}

export function hasClubRole(context: CabinetContext, clubId: string, role: Role) {
  return context.roles.some((item) => item.clubId === clubId && item.role === role)
}

export function canOperateSchedule(context: CabinetContext, clubId: string) {
  return hasClubRole(context, clubId, Role.TECH_ADMIN) || hasClubRole(context, clubId, Role.HOST_ADMIN)
}
