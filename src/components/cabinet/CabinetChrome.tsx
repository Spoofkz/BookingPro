'use client'

import { PERMISSIONS } from '@/src/lib/rbac'
import { Role } from '@prisma/client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import BookingProLogo from '@/src/components/common/BookingProLogo'

type RoleItem = {
  clubId: string | null
  role: Role
}

type ClubItem = {
  id: string
  name: string
  slug: string
  status: string
  timezone: string
  currency: string
}

type Capabilities = {
  global: string[]
  byClub: Record<string, string[]>
}

type MeResponse = {
  userId: string
  roles: RoleItem[]
  defaultClubId: string | null
  activeClubId: string | null
  activeRole: Role
  activeMode: 'CLIENT' | 'STAFF'
  defaultMode: 'CLIENT' | 'STAFF'
  hasClientPersona: boolean
  staffMembershipsCount: number
  clubs: ClubItem[]
  capabilities: Capabilities
  demoAuthEnabled?: boolean
  profile: {
    name: string
    phone: string | null
    email: string | null
  }
}

const demoUsers = [
  { label: 'System Owner (demo)', value: 'azamat@example.com' },
  { label: 'Host Admin (demo)', value: 'host@example.com' },
  { label: 'Club Owner (demo)', value: 'tech@example.com' },
  { label: 'Client Demo', value: 'client@example.com' },
]

type NavItem = {
  label: string
  href: string
  requiredGlobalPermission?: string
  requiredClubPermission?: string
}

const navBySegment: Record<string, NavItem[]> = {
  client: [
    {
      label: 'Dashboard',
      href: '/cabinet/client/dashboard',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'My Bookings',
      href: '/cabinet/client/my-bookings',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Payments',
      href: '/cabinet/client/payments',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Packages & Wallet',
      href: '/cabinet/client/memberships',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Profile',
      href: '/cabinet/client/profile',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Security',
      href: '/cabinet/client/security',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Support',
      href: '/cabinet/client/support',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
    {
      label: 'Privacy',
      href: '/cabinet/client/privacy',
      requiredGlobalPermission: PERMISSIONS.CLIENT_SELF_READ,
    },
  ],
  host: [
    {
      label: 'Today',
      href: '/cabinet/host/today',
      requiredClubPermission: PERMISSIONS.BOOKING_READ,
    },
    {
      label: 'Bookings',
      href: '/cabinet/host/bookings',
      requiredClubPermission: PERMISSIONS.BOOKING_READ,
    },
    {
      label: 'Live Map',
      href: '/cabinet/host/live-map',
      requiredClubPermission: PERMISSIONS.BOOKING_READ,
    },
    {
      label: 'Customers',
      href: '/cabinet/host/customers',
      requiredClubPermission: PERMISSIONS.CUSTOMER_READ,
    },
    {
      label: 'Payments',
      href: '/cabinet/host/payments',
      requiredClubPermission: PERMISSIONS.PAYMENT_MARK_PAID,
    },
    {
      label: 'Support',
      href: '/cabinet/host/support',
      requiredClubPermission: PERMISSIONS.BOOKING_READ,
    },
  ],
  tech: [
    {
      label: 'Overview',
      href: '/cabinet/tech/overview',
      requiredClubPermission: PERMISSIONS.CLUB_READ,
    },
    {
      label: 'Onboarding',
      href: '/cabinet/tech/onboarding',
      requiredClubPermission: PERMISSIONS.CLUB_READ,
    },
    {
      label: 'Map Editor',
      href: '/cabinet/tech/map-editor',
      requiredClubPermission: PERMISSIONS.MAP_EDIT,
    },
    {
      label: 'Pricing',
      href: '/cabinet/tech/pricing',
      requiredClubPermission: PERMISSIONS.PRICING_EDIT,
    },
    {
      label: 'Schedule',
      href: '/cabinet/tech/schedule',
      requiredClubPermission: PERMISSIONS.SCHEDULE_EDIT,
    },
    {
      label: 'Staff',
      href: '/cabinet/tech/staff',
      requiredClubPermission: PERMISSIONS.STAFF_INVITE_MANAGE,
    },
    {
      label: 'Policies',
      href: '/cabinet/tech/policies',
      requiredClubPermission: PERMISSIONS.CLUB_MANAGE_PROFILE,
    },
    {
      label: 'Audit',
      href: '/cabinet/tech/audit',
      requiredClubPermission: PERMISSIONS.CLUB_READ,
    },
  ],
}

function roleToSegment(role: Role) {
  if (role === Role.HOST_ADMIN) return 'host'
  if (role === Role.TECH_ADMIN) return 'tech'
  return 'client'
}

function formatRoleLabel(role: Role) {
  if (role === Role.TECH_ADMIN) return 'CLUB_OWNER'
  if (role === Role.HOST_ADMIN) return 'HOST_ADMIN'
  return 'CLIENT'
}

export default function CabinetChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [context, setContext] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoutBusy, setLogoutBusy] = useState<null | 'current' | 'all'>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  async function loadContext() {
    const response = await fetch('/api/me', { cache: 'no-store' })
    if (!response.ok) {
      throw new Error('Failed to load cabinet context.')
    }
    const data = (await response.json()) as MeResponse
    setContext(data)
  }

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        await loadContext()
      } catch (loadError) {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load cabinet context.',
          )
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  const segment = useMemo(() => {
    if (pathname.startsWith('/cabinet/host')) return 'host'
    if (pathname.startsWith('/cabinet/tech')) return 'tech'
    return 'client'
  }, [pathname])

  const roleOptions = useMemo(() => {
    if (!context) return []
    return context.roles
      .filter((item) => item.clubId === context.activeClubId || item.clubId === null)
      .map((item) => item.role)
      .filter((value, index, array) => array.indexOf(value) === index)
  }, [context])

  const activeClubCapabilities = useMemo(() => {
    if (!context?.activeClubId) return []
    return context.capabilities.byClub[context.activeClubId] ?? []
  }, [context])

  const navItems = useMemo(() => {
    const items = navBySegment[segment] ?? navBySegment.client
    if (!context) return []

    return items.filter((item) => {
      if (item.requiredGlobalPermission) {
        return context.capabilities.global.includes(item.requiredGlobalPermission)
      }
      if (item.requiredClubPermission) {
        if (!context.activeClubId) return false
        return activeClubCapabilities.includes(item.requiredClubPermission)
      }
      return true
    })
  }, [activeClubCapabilities, context, segment])

  const routeIsAccessible = useMemo(() => {
    if (!pathname.startsWith('/cabinet/')) return true
    if (pathname === '/cabinet' || pathname === '/cabinet/client' || pathname === '/cabinet/host' || pathname === '/cabinet/tech') {
      return true
    }
    return navItems.some((item) => item.href === pathname)
  }, [navItems, pathname])

  async function updateContext(payload: Record<string, string | null>) {
    setUpdating(true)
    setError(null)
    try {
      const response = await fetch('/api/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error || 'Failed to update context.')
      }
      const data = (await response.json()) as MeResponse
      setContext(data)
      const nextSegment = roleToSegment(data.activeRole)
      if (!pathname.startsWith(`/cabinet/${nextSegment}`)) {
        router.push(`/cabinet/${nextSegment}`)
      }
      router.refresh()
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update context.',
      )
    } finally {
      setUpdating(false)
    }
  }

  async function updateMode(activeMode: 'CLIENT' | 'STAFF') {
    setUpdating(true)
    setError(null)
    try {
      const response = await fetch('/api/me/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeMode }),
      })
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error || 'Failed to switch mode.')
      }
      const data = (await response.json()) as MeResponse
      setContext(data)
      if (data.activeMode === 'CLIENT') {
        router.push('/me')
      } else if (!pathname.startsWith('/cabinet/host') && !pathname.startsWith('/cabinet/tech')) {
        router.push('/cabinet')
      }
      router.refresh()
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to switch mode.',
      )
    } finally {
      setUpdating(false)
    }
  }

  async function logout(mode: 'current' | 'all') {
    if (logoutBusy) return
    setLogoutBusy(mode)
    setLogoutError(null)
    try {
      const response = await fetch(mode === 'all' ? '/api/auth/logout_all' : '/api/auth/logout', {
        method: 'POST',
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to logout.')
      }
      window.location.href = '/auth/client?loggedOut=1'
    } catch (logoutRequestError) {
      setLogoutError(
        logoutRequestError instanceof Error ? logoutRequestError.message : 'Failed to logout.',
      )
    } finally {
      setLogoutBusy(null)
    }
  }

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto w-full max-w-[1800px] space-y-4">
        <header className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <BookingProLogo href="/cabinet" subtitle="Staff Cabinet" />
            <span className="chip">Role-Based Portal</span>
            <span className="ml-auto text-xs text-[var(--muted)]">
              {loading ? 'Loading context...' : context?.profile.name}
            </span>
            <button
              type="button"
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
              onClick={() => void logout('current')}
              disabled={Boolean(logoutBusy)}
            >
              {logoutBusy === 'current' ? 'Logging out...' : 'Logout'}
            </button>
            <button
              type="button"
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
              onClick={() => void logout('all')}
              disabled={Boolean(logoutBusy)}
            >
              {logoutBusy === 'all' ? 'Logging out all...' : 'Logout All Devices'}
            </button>
          </div>

          {error ? (
            <div className="mt-3 panel-strong rounded-lg border-red-400/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}
          {logoutError ? (
            <div className="mt-3 panel-strong rounded-lg border-red-400/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
              {logoutError}
            </div>
          ) : null}

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            {context?.demoAuthEnabled ? (
              <label className="flex flex-col gap-1 text-xs">
                Demo User
                <select
                  className="panel-strong rounded-lg px-2 py-2 text-sm"
                  disabled={loading || updating}
                  onChange={(event) => void updateContext({ userEmail: event.target.value })}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Switch persona
                  </option>
                  {demoUsers.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="panel-strong rounded-lg px-3 py-2 text-xs">
                <p className="font-medium">Identity</p>
                <p className="mt-1 text-[var(--muted)]">Production auth mode</p>
              </div>
            )}

            <label className="flex flex-col gap-1 text-xs">
              Active Club
              <select
                className="panel-strong rounded-lg px-2 py-2 text-sm"
                disabled={loading || updating || !context || context.clubs.length === 0}
                value={context?.activeClubId ?? ''}
                onChange={(event) =>
                  void updateContext({ clubId: event.target.value || null, role: null })
                }
              >
                {context?.clubs.length ? null : (
                  <option value="">No clubs assigned</option>
                )}
                {(context?.clubs ?? []).map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name} ({club.status})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              Active Role
              <select
                className="panel-strong rounded-lg px-2 py-2 text-sm"
                disabled={loading || updating || !context}
                value={context?.activeRole ?? Role.CLIENT}
                onChange={(event) => void updateContext({ role: event.target.value })}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {formatRoleLabel(role)}
                  </option>
                ))}
              </select>
            </label>

            <div className="panel-strong rounded-lg px-3 py-2 text-xs">
              <p className="font-medium">Active Segment</p>
              <p className="mt-1 text-[var(--muted)]">{segment.toUpperCase()}</p>
            </div>
            <div className="panel-strong rounded-lg px-3 py-2 text-xs">
              <p className="font-medium">Persona Mode</p>
              <p className="mt-1 text-[var(--muted)]">
                {context?.activeMode || 'STAFF'} / default {context?.defaultMode || 'STAFF'}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
                  disabled={loading || updating || context?.activeMode === 'STAFF'}
                  onClick={() => void updateMode('STAFF')}
                >
                  Staff
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
                  disabled={
                    loading ||
                    updating ||
                    context?.activeMode === 'CLIENT' ||
                    !(context?.hasClientPersona ?? false)
                  }
                  onClick={() => void updateMode('CLIENT')}
                >
                  Client
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="panel p-3">
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      isActive
                        ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_18%,transparent)]'
                        : 'border-[var(--border)] hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {navItems.length === 0 ? (
                <p className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                  No accessible sections for current role and club.
                </p>
              ) : null}
              <Link
                href="/bookings"
                className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
              >
                Legacy Booking UI
              </Link>
            </nav>
          </aside>

          <section className="panel p-4 md:p-6">
            {(segment === 'host' || segment === 'tech') && context && !context.activeClubId ? (
              <div className="panel-strong rounded-lg p-4 text-sm">
                <p className="font-medium">Club context required</p>
                <p className="mt-1 text-[var(--muted)]">
                  Select an active club in the header to continue with staff operations.
                </p>
              </div>
            ) : !routeIsAccessible ? (
              <div className="panel-strong rounded-lg p-4 text-sm">
                <p className="font-medium">Access denied</p>
                <p className="mt-1 text-[var(--muted)]">
                  You do not have permission for this section in the selected club. Switch role or club.
                </p>
              </div>
            ) : (
              children
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
