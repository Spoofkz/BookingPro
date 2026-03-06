import { MembershipStatus, Role } from '@prisma/client'
import { cookies } from 'next/headers'
import {
  AUTH_SESSION_COOKIE,
  getSessionUserByToken,
  isDemoAuthEnabled,
} from '@/src/lib/authSession'
import { prisma } from '@/src/lib/prisma'

const DEMO_EMAIL_FALLBACK = 'azamat@example.com'
export const ACTIVE_CLUB_COOKIE = 'active_club_id'
export const ACTIVE_ROLE_COOKIE = 'active_role'
export const ACTIVE_MODE_COOKIE = 'active_mode'
export const DEMO_USER_COOKIE = 'demo_user_email'

type ContextRole = {
  clubId: string | null
  role: Role
}

type ContextMembership = {
  clubId: string
  role: Role
  status: MembershipStatus
}

export type CabinetContext = {
  userId: string
  authMethod: 'session' | 'demo'
  profile: {
    login: string | null
    name: string
    phone: string | null
    email: string | null
  }
  memberships: ContextMembership[]
  roles: ContextRole[]
  clubs: Array<{
    id: string
    name: string
    slug: string
    status: string
    timezone: string
    currency: string
  }>
  defaultClubId: string | null
  activeClubId: string | null
  activeRole: Role
  hasClientPersona: boolean
  staffMembershipsCount: number
  defaultMode: 'CLIENT' | 'STAFF'
  activeMode: 'CLIENT' | 'STAFF'
}

type GetCabinetContextOptions = {
  requireSession?: boolean
}

type CabinetMode = 'CLIENT' | 'STAFF'

function parseRole(input: string | undefined): Role | null {
  if (!input) return null
  if (input === Role.CLIENT) return Role.CLIENT
  if (input === Role.HOST_ADMIN) return Role.HOST_ADMIN
  if (input === Role.TECH_ADMIN) return Role.TECH_ADMIN
  return null
}

function parseMode(input: string | undefined): CabinetMode | null {
  if (!input) return null
  if (input === 'CLIENT') return 'CLIENT'
  if (input === 'STAFF') return 'STAFF'
  return null
}

function hasContextRole(context: CabinetContext, role: Role, clubId: string | null) {
  return context.roles.some((item) => item.role === role && item.clubId === clubId)
}

function selectActiveRole(context: CabinetContext, preferredRole: Role | null) {
  if (
    preferredRole === Role.CLIENT &&
    context.roles.some((item) => item.role === Role.CLIENT && item.clubId === null)
  ) {
    return Role.CLIENT
  }

  if (preferredRole && hasContextRole(context, preferredRole, context.activeClubId)) {
    return preferredRole
  }

  const clubRole = context.roles.find((item) => item.clubId === context.activeClubId)
  if (clubRole) return clubRole.role

  const globalClient = context.roles.find((item) => item.role === Role.CLIENT)
  if (globalClient) return globalClient.role

  return context.roles[0]?.role ?? Role.CLIENT
}

function pickFirstStaffMembership(
  memberships: ContextMembership[],
  clubId: string | null,
): ContextMembership | null {
  if (clubId) {
    const match = memberships.find(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE &&
        membership.clubId === clubId &&
        membership.role !== Role.CLIENT,
    )
    if (match) return match
  }
  return (
    memberships.find(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE && membership.role !== Role.CLIENT,
    ) || null
  )
}

function normalizeRoles(
  memberships: Array<{
    clubId: string
    role: Role
    status: MembershipStatus
  }>,
) {
  const roles: ContextRole[] = memberships
    .filter((item) => item.status === MembershipStatus.ACTIVE)
    .map((item) => ({
      clubId: item.clubId,
      role: item.role,
    }))

  if (!roles.some((item) => item.role === Role.CLIENT && item.clubId === null)) {
    roles.push({ clubId: null, role: Role.CLIENT })
  }

  return roles
}

function inferModeFromRole(role: Role): 'CLIENT' | 'STAFF' {
  return role === Role.CLIENT ? 'CLIENT' : 'STAFF'
}

async function loadDemoUser(emailFromCookie: string) {
  let user = await prisma.user.findUnique({
    where: { email: emailFromCookie },
    include: {
      memberships: {
        include: { club: true },
        orderBy: [{ createdAt: 'asc' }, { role: 'asc' }],
      },
    },
  })

  if (!user) {
    user = await prisma.user.findFirst({
      include: {
        memberships: {
          include: { club: true },
          orderBy: [{ createdAt: 'asc' }, { role: 'asc' }],
        },
      },
    })
  }
  return user
}

export async function getCabinetContext(
  options: GetCabinetContextOptions = {},
): Promise<CabinetContext> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(AUTH_SESSION_COOKIE)?.value || null
  const preferredClubId = cookieStore.get(ACTIVE_CLUB_COOKIE)?.value || null
  const preferredRole = parseRole(cookieStore.get(ACTIVE_ROLE_COOKIE)?.value)
  const preferredMode = parseMode(cookieStore.get(ACTIVE_MODE_COOKIE)?.value)
  const emailFromCookie = cookieStore.get(DEMO_USER_COOKIE)?.value || DEMO_EMAIL_FALLBACK

  let user = await getSessionUserByToken(sessionToken)
  let authMethod: 'session' | 'demo' = 'session'
  if (!user && !options.requireSession && isDemoAuthEnabled()) {
    user = await loadDemoUser(emailFromCookie)
    authMethod = 'demo'
  }

  if (!user) {
    throw new Error('Authentication required.')
  }

  const memberships = user.memberships.map((membership) => ({
    clubId: membership.clubId,
    role: membership.role,
    status: membership.status,
  }))
  const roles = normalizeRoles(memberships)
  const clubs = Array.from(
    new Map(
      user.memberships
        .filter((membership) => membership.status === MembershipStatus.ACTIVE)
        .map((membership) => [
        membership.club.id,
        {
          id: membership.club.id,
          name: membership.club.name,
          slug: membership.club.slug,
          status: membership.club.status,
          timezone: membership.club.timezone,
          currency: membership.club.currency,
        },
        ]),
    ).values(),
  )

  const defaultClubId = clubs[0]?.id ?? null
  let activeClubId = clubs.some((club) => club.id === preferredClubId)
    ? preferredClubId
    : defaultClubId

  const context: CabinetContext = {
    userId: user.id,
    authMethod,
    profile: {
      login: user.login,
      name: user.name,
      phone: user.phone,
      email: user.email,
    },
    memberships,
    roles,
    clubs,
    defaultClubId,
    activeClubId,
    activeRole: Role.CLIENT,
    hasClientPersona: roles.some((item) => item.role === Role.CLIENT && item.clubId === null),
    staffMembershipsCount: memberships.filter(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE &&
        membership.role !== Role.CLIENT,
    ).length,
    defaultMode: 'CLIENT',
    activeMode: 'CLIENT',
  }

  context.defaultMode = context.staffMembershipsCount > 0 ? 'STAFF' : 'CLIENT'
  const requestedMode =
    preferredMode === 'STAFF' && context.staffMembershipsCount > 0
      ? 'STAFF'
      : preferredMode === 'CLIENT'
        ? 'CLIENT'
        : context.defaultMode

  if (requestedMode === 'CLIENT') {
    context.activeRole = Role.CLIENT
    context.activeMode = 'CLIENT'
    return context
  }

  let staffSelection: ContextMembership | null = null
  if (preferredRole && preferredRole !== Role.CLIENT) {
    staffSelection =
      context.memberships.find(
        (membership) =>
          membership.status === MembershipStatus.ACTIVE &&
          membership.role === preferredRole &&
          membership.clubId === activeClubId,
      ) ||
      context.memberships.find(
        (membership) =>
          membership.status === MembershipStatus.ACTIVE &&
          membership.role === preferredRole,
      ) ||
      null
  }
  if (!staffSelection) {
    staffSelection = pickFirstStaffMembership(context.memberships, activeClubId)
  }

  if (!staffSelection) {
    context.activeRole = selectActiveRole(context, preferredRole)
    context.activeMode = inferModeFromRole(context.activeRole)
    return context
  }

  activeClubId = staffSelection.clubId
  context.activeClubId = activeClubId
  context.activeRole = staffSelection.role
  context.activeMode = 'STAFF'

  return context
}

export function canUseRoleForActiveClub(context: CabinetContext, role: Role) {
  return hasContextRole(context, role, context.activeClubId)
}

export function requireActiveClub(context: CabinetContext) {
  if (!context.activeClubId) {
    throw new Error('No active club selected.')
  }
  return context.activeClubId
}

export function requireAnyRole(context: CabinetContext, roles: Role[]) {
  if (!roles.some((role) => canUseRoleForActiveClub(context, role))) {
    throw new Error('Forbidden for current role and club context.')
  }
}
