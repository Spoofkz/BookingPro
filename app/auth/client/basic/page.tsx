import Link from 'next/link'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function pickSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function BasicClientAuthPage({ searchParams }: PageProps) {
  const resolved = (await searchParams) ?? {}
  const error = pickSingle(resolved.error)
  const success = pickSingle(resolved.success)

  return (
    <main className="min-h-screen w-full p-4 md:p-8">
      <section className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <header className="panel p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Client Access</p>
          <h1 className="mt-2 text-2xl font-semibold">Basic Auth Fallback (No JS)</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Use this page if the normal auth page looks read-only. It submits through regular HTML forms.
          </p>
        </header>

        {error ? (
          <p className="rounded-lg border border-rose-400/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-lg border border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {success}
          </p>
        ) : null}

        <article className="panel-strong grid gap-4 p-5 md:grid-cols-2">
          <form action="/auth/client/basic/register" method="post" className="space-y-3">
            <h2 className="text-base font-semibold">Quick Register</h2>
            <label className="flex flex-col gap-1 text-sm">
              Login
              <input className="panel rounded-lg px-3 py-2" name="login" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input type="email" className="panel rounded-lg px-3 py-2" name="email" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Phone number
              <input className="panel rounded-lg px-3 py-2" name="phone" placeholder="+77011234567" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input
                type="password"
                className="panel rounded-lg px-3 py-2"
                name="password"
                minLength={8}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90"
            >
              Create Account
            </button>
          </form>

          <form action="/auth/client/basic/login" method="post" className="space-y-3">
            <h2 className="text-base font-semibold">Login</h2>
            <label className="flex flex-col gap-1 text-sm">
              Login / Email / Phone
              <input className="panel rounded-lg px-3 py-2" name="identifier" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Password
              <input type="password" className="panel rounded-lg px-3 py-2" name="password" required />
            </label>
            <button
              type="submit"
              className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_25%,transparent)] px-3 py-2 text-sm hover:opacity-90"
            >
              Login
            </button>
          </form>
        </article>

        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/auth/client" className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10">
            Open normal auth page
          </Link>
          <Link href="/bookings" className="rounded-lg border border-[var(--border)] px-3 py-1 hover:bg-white/10">
            Open Booking Page
          </Link>
        </div>
      </section>
    </main>
  )
}
