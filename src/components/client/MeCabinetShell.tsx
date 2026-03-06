'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode, useState } from 'react'
import BookingProLogo from '@/src/components/common/BookingProLogo'

type NavItem = {
  label: string
  href: string
}

const navItems: NavItem[] = [
  { label: 'Overview', href: '/me' },
  { label: 'My Bookings', href: '/me/bookings' },
  { label: 'Wallet & Packs', href: '/me/wallet' },
  { label: 'Payments & Receipts', href: '/me/invoices' },
  { label: 'Support', href: '/me/support' },
  { label: 'Profile & Preferences', href: '/me/profile' },
  { label: 'Security & Devices', href: '/me/security' },
  { label: 'Privacy & Consents', href: '/me/privacy' },
]

export default function MeCabinetShell({
  profileName,
  activeMode,
  hasStaffPersona,
  children,
}: {
  profileName: string
  activeMode: 'CLIENT' | 'STAFF'
  hasStaffPersona: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const [modeBusy, setModeBusy] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [logoutBusy, setLogoutBusy] = useState<null | 'current' | 'all'>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  async function switchMode(nextMode: 'CLIENT' | 'STAFF') {
    if (modeBusy) return
    setModeBusy(true)
    setModeError(null)
    try {
      const response = await fetch('/api/me/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeMode: nextMode }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to switch mode.')
      }
      if (nextMode === 'STAFF') {
        window.location.href = '/cabinet'
      } else {
        window.location.href = '/me'
      }
    } catch (error) {
      setModeError(error instanceof Error ? error.message : 'Failed to switch mode.')
    } finally {
      setModeBusy(false)
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
      window.location.href = '/auth/client'
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Failed to logout.')
    } finally {
      setLogoutBusy(null)
    }
  }

  return (
    <main className="min-h-screen w-full p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4">
        <header className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <BookingProLogo href="/me" subtitle="Client Cabinet" />
            <span className="chip">Customer Self-Service</span>
            <span className="chip">Mode: {activeMode}</span>
            <span className="ml-auto text-xs text-[var(--muted)]">{profileName}</span>
            {hasStaffPersona ? (
              <button
                type="button"
                className="rounded-full border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10 disabled:opacity-60"
                onClick={() => void switchMode(activeMode === 'CLIENT' ? 'STAFF' : 'CLIENT')}
                disabled={modeBusy}
              >
                {modeBusy
                  ? 'Switching...'
                  : activeMode === 'CLIENT'
                    ? 'Switch To Staff'
                    : 'Switch To Client'}
              </button>
            ) : null}
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
          {modeError ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{modeError}</p> : null}
          {logoutError ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{logoutError}</p> : null}
          {activeMode === 'STAFF' ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Staff mode is active. Use the switch button to return to client mode for customer self-service actions.
            </p>
          ) : null}
        </header>

        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="panel p-3">
            <nav className="flex flex-col gap-1">
              {navItems.map((item) => {
                const isActive =
                  pathname === item.href || (item.href !== '/me' && pathname.startsWith(`${item.href}/`))
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
              <Link
                href="/bookings"
                className="mt-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10"
              >
                Book New Session
              </Link>
            </nav>
          </aside>

          <section className="panel p-4 md:p-6">{children}</section>
        </div>
      </div>
    </main>
  )
}
