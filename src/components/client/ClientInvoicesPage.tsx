'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type InvoiceListItem = {
  invoiceId: string
  receiptNumber: string
  paymentId: number | null
  status: string
  amountCents: number
  currency: string
  issuedAt: string
  receiptType: string
  method: string
  providerRef: string | null
  booking: {
    id: number
    status: string
    paymentStatus: string
    checkIn: string
    checkOut: string
    guestName: string
    guestEmail: string
    room: { id: number; name: string } | null
    club: {
      id: string
      name: string
      slug: string
      city: string | null
      address: string | null
      currency: string
    } | null
  } | null
  downloadPdfUrl: string
}

function formatMoney(amountKzt: number, _currency: string) {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

export default function ClientInvoicesPage() {
  const [items, setItems] = useState<InvoiceListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function run() {
      try {
        setLoading(true)
        setError(null)
        const response = await fetch('/api/client/invoices?pageSize=100', { cache: 'no-store' })
        const payload = await readJson<{ items: InvoiceListItem[] }>(
          response,
          'Failed to load invoices.',
        )
        if (!mounted) return
        setItems(payload.items || [])
      } catch (loadError) {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load invoices.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void run()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Invoices & Receipts</h2>
      <p className="text-sm text-[var(--muted)]">
        Paid records for online and offline bookings. You can open printable receipt pages for each
        payment.
      </p>

      {loading ? <p className="text-sm text-[var(--muted)]">Loading invoices...</p> : null}
      {error ? <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}

      {!loading && !error && items.length === 0 ? (
        <article className="panel-strong p-4 text-sm text-[var(--muted)]">
          No invoices or receipts yet.
        </article>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <article key={item.invoiceId} className="panel-strong space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {item.receiptNumber} · {item.status}
                </p>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {new Date(item.issuedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {item.booking?.club?.name || 'Club'} · booking #{item.booking?.id || 'N/A'} ·{' '}
                {item.booking?.room?.name || 'N/A'}
              </p>
              <p className="text-sm">
                {formatMoney(item.amountCents, item.currency)} · {item.method}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/me/invoices/${item.invoiceId}`}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Open details
                </Link>
                <a
                  href={item.downloadPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Print / download
                </a>
                {item.booking ? (
                  <Link
                    href={`/me/bookings/${item.booking.id}`}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                  >
                    Open booking
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  )
}
