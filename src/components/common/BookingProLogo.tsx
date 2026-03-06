import Link from 'next/link'

type BookingProLogoProps = {
  href?: string
  subtitle?: string
  className?: string
}

export default function BookingProLogo({
  href = '/',
  subtitle,
  className = '',
}: BookingProLogoProps) {
  return (
    <Link href={href} className={`inline-flex items-center gap-3 ${className}`.trim()}>
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[color-mix(in_oklab,var(--accent)_22%,transparent)]"
        aria-hidden="true"
      >
        <span className="text-sm font-bold">BP</span>
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-semibold">BookingPro</span>
        {subtitle ? (
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {subtitle}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
