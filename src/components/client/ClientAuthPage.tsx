'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BookingProLogo from '@/src/components/common/BookingProLogo'

type ErrorPayload = {
  error?: string
}

type OtpSendPayload = {
  error?: string
  devCode?: string
}

type MeContextPayload = {
  activeMode?: 'CLIENT' | 'STAFF'
  activeRole?: 'CLIENT' | 'HOST_ADMIN' | 'TECH_ADMIN'
  staffMembershipsCount?: number
}

const AUTH_REQUEST_TIMEOUT_MS = 15000

async function fetchJsonWithTimeout<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    const payload = (await response.json()) as T & { error?: string }
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed.')
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export default function ClientAuthPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'register' | 'login' | 'otp'>('login')
  const [registerForm, setRegisterForm] = useState({
    login: '',
    email: '',
    phone: '',
    password: '',
  })
  const [loginForm, setLoginForm] = useState({
    identifier: '',
    password: '',
  })
  const [otpForm, setOtpForm] = useState({
    phone: '',
    code: '',
  })
  const [sendBusy, setSendBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  useEffect(() => {
    // Defensive fix: if any prior modal/shell leaves app root inert or non-interactive,
    // force interactive state for the auth page.
    const html = document.documentElement
    const body = document.body
    const appRoot = document.getElementById('__next')

    html.removeAttribute('inert')
    body.removeAttribute('inert')
    appRoot?.removeAttribute('inert')

    html.style.pointerEvents = 'auto'
    body.style.pointerEvents = 'auto'
    if (appRoot instanceof HTMLElement) {
      appRoot.style.pointerEvents = 'auto'
    }

    return () => {
      // Keep this no-op to avoid reverting potentially intentional styles from other pages.
    }
  }, [])

  const successMessage = useMemo(() => {
    if (searchParams.get('loggedOut') === '1') return 'You have been logged out.'
    return null
  }, [searchParams])

  async function redirectAfterAuth(defaultClientPath = '/me/profile') {
    try {
      const context = await fetchJsonWithTimeout<MeContextPayload>('/api/me/context', {
        cache: 'no-store',
      })
      if (
        context.activeMode === 'STAFF' ||
        context.activeRole === 'HOST_ADMIN' ||
        context.activeRole === 'TECH_ADMIN'
      ) {
        router.push('/cabinet')
        return
      }
    } catch {
      // Fall back to client profile route.
    }
    router.push(defaultClientPath)
  }

  async function sendOtp() {
    const normalizedPhone = otpForm.phone.trim()
    if (!normalizedPhone) {
      setError('Phone is required.')
      return
    }

    setSendBusy(true)
    setError(null)
    setMessage(null)
    setDevCode(null)
    try {
      const payload = await fetchJsonWithTimeout<OtpSendPayload>('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone }),
      })
      setMessage('OTP sent. Verify to login.')
      setDevCode(payload.devCode || null)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Failed to send OTP.')
    } finally {
      setSendBusy(false)
    }
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPhone = otpForm.phone.trim()
    const normalizedCode = otpForm.code.trim()
    if (!normalizedPhone || !normalizedCode) {
      setError('Phone and OTP code are required.')
      return
    }

    setActionBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fetchJsonWithTimeout<ErrorPayload>('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalizedPhone, code: normalizedCode }),
      })
      await redirectAfterAuth('/me/profile')
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Failed to verify OTP.')
    } finally {
      setActionBusy(false)
    }
  }

  async function registerWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fetchJsonWithTimeout<ErrorPayload>('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: registerForm.login,
          email: registerForm.email,
          phone: registerForm.phone,
          password: registerForm.password,
        }),
      })
      await redirectAfterAuth('/me/profile')
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Failed to register.')
    } finally {
      setActionBusy(false)
    }
  }

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionBusy(true)
    setError(null)
    setMessage(null)
    try {
      await fetchJsonWithTimeout<ErrorPayload>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: loginForm.identifier,
          password: loginForm.password,
        }),
      })
      await redirectAfterAuth('/me/profile')
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Failed to login.')
    } finally {
      setActionBusy(false)
    }
  }

  async function openStaffCabinet() {
    setActionBusy(true)
    setError(null)
    setMessage(null)
    try {
      const context = await fetchJsonWithTimeout<MeContextPayload>('/api/me/context', {
        cache: 'no-store',
      })

      if ((context.staffMembershipsCount || 0) < 1) {
        setError('No active staff membership found for this account.')
        return
      }

      await fetchJsonWithTimeout<ErrorPayload>('/api/me/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeMode: 'STAFF' }),
      })

      router.push('/cabinet')
    } catch (staffError) {
      setError(staffError instanceof Error ? staffError.message : 'Failed to open staff cabinet.')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <main className="min-h-screen w-full p-4 md:p-8 relative z-[2147483000] pointer-events-auto">
      <section className="mx-auto flex w-full max-w-[680px] flex-col gap-4 pointer-events-auto">
        <header className="panel p-5">
          <BookingProLogo href="/" subtitle="Client Access" />
          <h1 className="mt-3 text-2xl font-semibold">Auth</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Login first. If you are new, use quick register with login, email, phone, and password,
            then complete your profile.
          </p>
        </header>

        <article className="panel-strong space-y-3 p-5">
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              className={`rounded-lg border px-3 py-1 ${
                mode === 'login'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_20%,transparent)]'
                  : 'border-[var(--border)] hover:bg-white/10'
              }`}
              onClick={() => setMode('login')}
              aria-label="Switch to password login mode"
            >
              Login (Password)
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1 ${
                mode === 'register'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_20%,transparent)]'
                  : 'border-[var(--border)] hover:bg-white/10'
              }`}
              onClick={() => setMode('register')}
              aria-label="Switch to register mode"
            >
              Quick Register
            </button>
            <button
              type="button"
              className={`rounded-lg border px-3 py-1 ${
                mode === 'otp'
                  ? 'border-[var(--accent)] bg-[color-mix(in_oklab,var(--accent)_20%,transparent)]'
                  : 'border-[var(--border)] hover:bg-white/10'
              }`}
              onClick={() => setMode('otp')}
              aria-label="Switch to OTP login mode"
            >
              Login (OTP)
            </button>
          </div>

          {(actionBusy || sendBusy) ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
              <span>Auth request in progress...</span>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-1 hover:bg-white/10"
                onClick={() => {
                  setActionBusy(false)
                  setSendBusy(false)
                  setError('Request was reset. Please try again.')
                }}
              >
                Reset
              </button>
            </div>
          ) : null}

          {successMessage ? (
            <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              {successMessage}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-400/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              {message}
            </p>
          ) : null}

          {mode === 'register' ? (
            <form onSubmit={registerWithPassword} className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Login
                  <input
                    className="panel rounded-lg px-3 py-2"
                    value={registerForm.login}
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, login: event.target.value }))
                    }
                    placeholder="my_login"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Email
                  <input
                    type="email"
                    className="panel rounded-lg px-3 py-2"
                    value={registerForm.email}
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="name@example.com"
                    required
                  />
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Phone number
                  <input
                    className="panel rounded-lg px-3 py-2"
                    value={registerForm.phone}
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, phone: event.target.value }))
                    }
                    placeholder="+77011234567"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Password
                  <input
                    type="password"
                    className="panel rounded-lg px-3 py-2"
                    value={registerForm.password}
                    onChange={(event) =>
                      setRegisterForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="At least 8 characters"
                    required
                  />
                </label>
              </div>
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                disabled={actionBusy}
              >
                {actionBusy ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          ) : null}

          {mode === 'login' ? (
            <form onSubmit={loginWithPassword} className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                Login / Email / Phone
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={loginForm.identifier}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, identifier: event.target.value }))
                  }
                  placeholder="my_login or name@example.com or +7701..."
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Password
                <input
                  type="password"
                  className="panel rounded-lg px-3 py-2"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                  required
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                disabled={actionBusy}
              >
                {actionBusy ? 'Signing in...' : 'Login'}
              </button>
            </form>
          ) : null}

          {mode === 'otp' ? (
            <form onSubmit={verifyOtp} className="space-y-3">
              <label className="flex flex-col gap-1 text-sm">
                Phone
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={otpForm.phone}
                  onChange={(event) =>
                    setOtpForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  placeholder="+77011234567"
                  required
                />
              </label>

              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                onClick={() => void sendOtp()}
                disabled={sendBusy || actionBusy}
              >
                {sendBusy ? 'Sending...' : 'Send OTP'}
              </button>

              <label className="flex flex-col gap-1 text-sm">
                OTP Code
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={otpForm.code}
                  onChange={(event) =>
                    setOtpForm((current) => ({ ...current, code: event.target.value }))
                  }
                  placeholder="6-digit code"
                  required
                />
              </label>

              {devCode ? (
                <p className="text-xs text-[var(--muted)]">
                  Dev code: <span className="font-semibold">{devCode}</span>
                </p>
              ) : null}

              <button
                type="submit"
                className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
                disabled={actionBusy}
              >
                {actionBusy ? 'Verifying...' : 'Verify & Open Client Profile'}
              </button>
            </form>
          ) : null}

          <div className="flex flex-wrap gap-2 text-xs">
            <Link href="/bookings" className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10">
              Open Booking Page
            </Link>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-50"
              onClick={() => void openStaffCabinet()}
              disabled={actionBusy || sendBusy}
            >
              Open Staff Cabinet
            </button>
          </div>
        </article>
      </section>
    </main>
  )
}
