'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

type AccountProfile = {
  login: string | null
  name: string
  phone: string | null
  email: string | null
}

type AccountResponse = {
  profile: AccountProfile
  changed?: boolean
  sensitiveChanged?: boolean
  revokedSessions?: number
  error?: string
  code?: string
}

function normalizeNullable(value: string | null | undefined) {
  if (value == null) return ''
  return value.trim()
}

export default function AccountSettingsSection({
  heading = 'Account & Security',
  subtitle,
}: {
  heading?: string
  subtitle?: string
}) {
  const [loading, setLoading] = useState(true)
  const [saveBusy, setSaveBusy] = useState(false)
  const [otpBusy, setOtpBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [baseProfile, setBaseProfile] = useState<AccountProfile | null>(null)
  const [form, setForm] = useState({
    login: '',
    name: '',
    phone: '',
    email: '',
  })
  const [otpCode, setOtpCode] = useState('')
  const [revokeOtherSessionsOnSensitiveChange, setRevokeOtherSessionsOnSensitiveChange] = useState(true)

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    revokeOtherSessions: true,
  })

  const sensitiveChanged = useMemo(() => {
    if (!baseProfile) return false
    return (
      normalizeNullable(form.phone) !== normalizeNullable(baseProfile.phone) ||
      normalizeNullable(form.email).toLowerCase() !== normalizeNullable(baseProfile.email).toLowerCase()
    )
  }, [baseProfile, form.email, form.phone])

  async function loadAccount() {
    const response = await fetch('/api/me/account', { cache: 'no-store' })
    const payload = (await response.json()) as AccountResponse
    if (!response.ok || !payload.profile) {
      throw new Error(payload.error || 'Failed to load account profile.')
    }
    setBaseProfile(payload.profile)
    setForm({
      login: payload.profile.login || '',
      name: payload.profile.name || '',
      phone: payload.profile.phone || '',
      email: payload.profile.email || '',
    })
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        await loadAccount()
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load account profile.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSendOtp() {
    if (!baseProfile?.phone) {
      setError('Current verified phone is required to request OTP for step-up.')
      return
    }
    setOtpBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: baseProfile.phone }),
      })
      const payload = (await response.json()) as {
        error?: string
        devCode?: string
      }
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to request OTP.')
      }
      setMessage(
        payload.devCode
          ? `OTP sent to current phone. Dev code: ${payload.devCode}`
          : 'OTP sent to current phone.',
      )
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : 'Failed to request OTP.')
    } finally {
      setOtpBusy(false)
    }
  }

  async function handleSaveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setError('Name is required.')
      return
    }

    setSaveBusy(true)
    setError(null)
    setMessage(null)

    try {
      const response = await fetch('/api/me/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login: form.login.trim(),
          name,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          otpCode: otpCode.trim() || undefined,
          revokeOtherSessions: revokeOtherSessionsOnSensitiveChange,
        }),
      })
      const payload = (await response.json()) as AccountResponse
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error || 'Failed to update account.')
      }

      setBaseProfile(payload.profile)
      setForm({
        login: payload.profile.login || '',
        name: payload.profile.name || '',
        phone: payload.profile.phone || '',
        email: payload.profile.email || '',
      })
      setOtpCode('')
      setMessage(
        payload.revokedSessions && payload.revokedSessions > 0
          ? `Account updated. Revoked ${payload.revokedSessions} other session(s).`
          : 'Account updated.',
      )
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update account.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const currentPassword = passwordForm.currentPassword.trim()
    const newPassword = passwordForm.newPassword.trim()
    const confirmPassword = passwordForm.confirmPassword.trim()

    if (!newPassword) {
      setError('New password is required.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }

    setPasswordBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentPassword || null,
          newPassword,
          revokeOtherSessions: passwordForm.revokeOtherSessions,
        }),
      })
      const payload = (await response.json()) as {
        ok?: boolean
        revokedSessions?: number
        error?: string
      }
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || 'Failed to change password.')
      }

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        revokeOtherSessions: passwordForm.revokeOtherSessions,
      })
      setMessage(
        payload.revokedSessions && payload.revokedSessions > 0
          ? `Password changed. Revoked ${payload.revokedSessions} other session(s).`
          : 'Password changed successfully.',
      )
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : 'Failed to change password.')
    } finally {
      setPasswordBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading account settings...</p>
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">{heading}</h2>
      {subtitle ? <p className="text-sm text-[var(--muted)]">{subtitle}</p> : null}
      {error ? (
        <article className="panel-strong rounded-lg border-red-400/40 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </article>
      ) : null}
      {message ? (
        <article className="panel-strong rounded-lg border-emerald-400/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          {message}
        </article>
      ) : null}

      <form onSubmit={handleSaveAccount} className="panel-strong space-y-3 p-4">
        <h3 className="text-base font-semibold">Personal Info</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Login
            <input
              className="panel rounded-lg px-3 py-2"
              value={form.login}
              onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))}
              placeholder="your_login"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Full Name
            <input
              className="panel rounded-lg px-3 py-2"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Your name"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Phone
            <input
              className="panel rounded-lg px-3 py-2"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="+7..."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              className="panel rounded-lg px-3 py-2"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="you@example.com"
            />
          </label>
        </div>

        {sensitiveChanged ? (
          <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm font-medium">Step-up verification required</p>
            <p className="text-xs text-[var(--muted)]">
              Changing phone/email requires OTP verification to your current phone.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-sm">
                OTP code
                <input
                  className="panel rounded-lg px-3 py-2"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="8888"
                />
              </label>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
                onClick={() => void handleSendOtp()}
                disabled={otpBusy}
              >
                {otpBusy ? 'Sending OTP...' : 'Send OTP'}
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={revokeOtherSessionsOnSensitiveChange}
                onChange={(event) => setRevokeOtherSessionsOnSensitiveChange(event.target.checked)}
              />
              Revoke other sessions after sensitive account update
            </label>
          </div>
        ) : null}

        <button
          type="submit"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          disabled={saveBusy}
        >
          {saveBusy ? 'Saving...' : 'Save account info'}
        </button>
      </form>

      <form onSubmit={handleChangePassword} className="panel-strong space-y-3 p-4">
        <h3 className="text-base font-semibold">Credentials</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Current Password
            <input
              type="password"
              className="panel rounded-lg px-3 py-2"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
              }
              placeholder="Current password"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            New Password
            <input
              type="password"
              className="panel rounded-lg px-3 py-2"
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
              }
              placeholder="New password"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Confirm Password
            <input
              type="password"
              className="panel rounded-lg px-3 py-2"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
              }
              placeholder="Confirm new password"
              required
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={passwordForm.revokeOtherSessions}
            onChange={(event) =>
              setPasswordForm((current) => ({ ...current, revokeOtherSessions: event.target.checked }))
            }
          />
          Revoke all other active sessions
        </label>
        <button
          type="submit"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
          disabled={passwordBusy}
        >
          {passwordBusy ? 'Changing password...' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
