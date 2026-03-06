'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type InvoiceDetail = {
  invoiceId: string
  receiptNumber: string
  issuedAt: string
  status: string
  method: string
  providerRef: string | null
  amountCents: number
  currency: string
  booking: {
    id: number
    status: string
    paymentStatus: string
    checkIn: string
    checkOut: string
    guestName: string
    guestEmail: string
    guestPhone: string | null
    room: { id: number; name: string } | null
    club: {
      id: string
      name: string
      slug: string
      city: string | null
      address: string | null
      currency: string
      timezone: string
    } | null
  } | null
  breakdown: {
    lineItems?: Array<{
      title?: string
      amountCents?: number
      amount?: number
      type?: string
    }>
    totalCents?: number | null
  }
  printableUrl: string
}

function formatMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

export default function ClientInvoiceDetailsPage({ invoiceId }: { invoiceId: string }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch(`/api/client/invoices/${invoiceId}`, { cache: 'no-store' })
        const payload = await readJson<InvoiceDetail>(response, 'Failed to load invoice.')
        if (!mounted) return
        setDetail(payload)
      } catch (loadError) {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load invoice.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [invoiceId])

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading invoice...</p>
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-rose-700 dark:text-rose-300">{error || 'Invoice not found.'}</p>
        <Link href="/me/invoices" className="text-sm underline">
          Back to invoices
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold">Receipt #{detail.receiptNumber}</h2>
        <span className="ml-auto text-xs text-[var(--muted)]">
          {new Date(detail.issuedAt).toLocaleString()}
        </span>
      </div>

      <article className="panel-strong space-y-2 p-4 text-sm">
        <p>
          Status: <strong>{detail.status}</strong>
        </p>
        <p>
          Amount: <strong>{formatMoney(detail.amountCents, detail.currency)}</strong>
        </p>
        <p>Method: {detail.method}</p>
        {detail.providerRef ? <p>Provider reference: {detail.providerRef}</p> : null}
      </article>

      <article className="panel-strong space-y-2 p-4 text-sm">
        <h3 className="text-base font-semibold">Booking summary</h3>
        <p>
          Booking #{detail.booking?.id || 'N/A'} · {detail.booking?.status || 'N/A'} ·{' '}
          {detail.booking?.paymentStatus || 'N/A'}
        </p>
        <p>
          Club: {detail.booking?.club?.name || 'N/A'} · Room: {detail.booking?.room?.name || 'N/A'}
        </p>
        <p>
          Session:{' '}
          {detail.booking
            ? `${new Date(detail.booking.checkIn).toLocaleString()} - ${new Date(
                detail.booking.checkOut,
              ).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : 'N/A'}
        </p>
        <p>
          Customer:{' '}
          {detail.booking
            ? `${detail.booking.guestName} (${detail.booking.guestEmail})`
            : 'N/A'}
        </p>
      </article>

      <article className="panel-strong space-y-2 p-4 text-sm">
        <h3 className="text-base font-semibold">Price breakdown snapshot</h3>
        {(detail.breakdown.lineItems || []).length === 0 ? (
          <p className="text-[var(--muted)]">No line items captured for this booking snapshot.</p>
        ) : (
          <ul className="space-y-1">
            {(detail.breakdown.lineItems || []).map((line, index) => {
              const amount =
                typeof line.amountCents === 'number'
                  ? line.amountCents
                  : typeof line.amount === 'number'
                    ? Math.round(line.amount)
                    : 0
              return (
                <li key={`${line.type || 'line'}-${index}`} className="flex items-center justify-between gap-2">
                  <span>{line.title || line.type || 'Line item'}</span>
                  <span>{formatMoney(amount, detail.currency)}</span>
                </li>
              )
            })}
          </ul>
        )}
        {typeof detail.breakdown.totalCents === 'number' ? (
          <p className="pt-2 text-sm font-semibold">
            Snapshot total: {formatMoney(detail.breakdown.totalCents, detail.currency)}
          </p>
        ) : null}
      </article>

      <div className="flex flex-wrap gap-2">
        <a
          href={detail.printableUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
        >
          Print / download
        </a>
        {detail.booking ? (
          <Link
            href={`/me/bookings/${detail.booking.id}`}
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
          >
            Open booking
          </Link>
        ) : null}
        <Link href="/me/invoices" className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10">
          Back to invoices
        </Link>
      </div>
    </div>
  )
}
