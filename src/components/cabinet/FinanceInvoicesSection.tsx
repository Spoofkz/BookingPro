'use client'

import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react'

type FinanceSummary = {
  totalDocuments: number
  totalAmountCents: number
  invoiceDocuments: number
  receiptDocuments: number
  paidAmountCents: number
  pendingAmountCents: number
  refundedAmountCents: number
}

type FinanceListItem = {
  recordId: string
  sourceType: 'INVOICE' | 'RECEIPT'
  invoiceId: string | null
  paymentId: number | null
  invoiceNumber: string
  orderNumber: string | null
  documentStatus: string
  paymentState: string
  issuedAt: string
  amountCents: number
  currency: string
  method: string
  providerRef: string | null
  bookingId: number | null
  guestName: string | null
  guestEmail: string | null
  roomName: string | null
  clubId: string
}

type FinanceDetail = {
  recordId: string
  sourceType: 'INVOICE' | 'RECEIPT'
  invoiceId: string | null
  paymentId: number | null
  invoiceNumber: string
  orderNumber: string | null
  issueDate: string
  documentStatus: string
  paymentState: string
  amountCents: number
  currency: string
  subtotalCents: number
  discountTotalCents: number
  taxTotalCents: number
  totalCents: number
  method: string
  providerRef: string | null
  customer: {
    name: string | null
    email: string | null
    phone: string | null
  }
  booking: {
    id: number
    status: string
    paymentStatus: string
    checkIn: string
    checkOut: string
    seatLabel: string | null
    roomName: string | null
    clubName: string | null
    clubAddress: string | null
    clubCity: string | null
  } | null
  lineItems: Array<{
    title: string
    quantity: number
    unitAmountCents: number
    totalAmountCents: number
    type: string
  }>
}

type FinanceResponse = {
  items: FinanceListItem[]
  page: number
  pageSize: number
  total: number
  summary: FinanceSummary
}

type FiltersState = {
  source: 'ALL' | 'INVOICE' | 'RECEIPT'
  status: string
  q: string
  dateFrom: string
  dateTo: string
}

function formatMoney(amountKzt: number, _currency: string) {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

function formatDateTime(value: string | null) {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

const modalSurfaceStyle: CSSProperties = {
  background: 'var(--background)',
  borderColor: 'var(--border)',
  color: 'var(--foreground)',
}

const modalSectionStyle: CSSProperties = {
  background: 'color-mix(in oklab, var(--background) 94%, var(--foreground) 6%)',
  borderColor: 'var(--border)',
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

function buildSearchParams(filters: FiltersState) {
  const search = new URLSearchParams()
  search.set('page', '1')
  search.set('pageSize', '200')
  if (filters.source && filters.source !== 'ALL') search.set('source', filters.source)
  if (filters.status) search.set('status', filters.status)
  if (filters.q.trim()) search.set('q', filters.q.trim())
  if (filters.dateFrom) search.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) search.set('dateTo', filters.dateTo)
  return search
}

export default function FinanceInvoicesSection({ activeClubId }: { activeClubId: string }) {
  const [filters, setFilters] = useState<FiltersState>({
    source: 'ALL',
    status: '',
    q: '',
    dateFrom: '',
    dateTo: '',
  })
  const [records, setRecords] = useState<FinanceListItem[]>([])
  const [summary, setSummary] = useState<FinanceSummary>({
    totalDocuments: 0,
    totalAmountCents: 0,
    invoiceDocuments: 0,
    receiptDocuments: 0,
    paidAmountCents: 0,
    pendingAmountCents: 0,
    refundedAmountCents: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [detail, setDetail] = useState<FinanceDetail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  async function loadRecords(nextFilters: FiltersState) {
    setLoading(true)
    setError(null)
    try {
      const query = buildSearchParams(nextFilters)
      const response = await fetch(
        `/api/clubs/${activeClubId}/finance/invoices?${query.toString()}`,
        {
          cache: 'no-store',
          headers: {
            'X-Club-Id': activeClubId,
          },
        },
      )
      const payload = await readJson<FinanceResponse>(response, 'Failed to load finance documents.')
      setRecords(payload.items || [])
      setSummary(payload.summary)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load finance documents.')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(recordId: string) {
    setSelectedRecordId(recordId)
    setDetailOpen(true)
    setDetailBusy(true)
    setDetailError(null)
    try {
      const response = await fetch(
        `/api/clubs/${activeClubId}/finance/invoices/${recordId}`,
        {
          cache: 'no-store',
          headers: {
            'X-Club-Id': activeClubId,
          },
        },
      )
      const payload = await readJson<FinanceDetail>(response, 'Failed to load finance document details.')
      setDetail(payload)
    } catch (loadError) {
      setDetail(null)
      setDetailError(loadError instanceof Error ? loadError.message : 'Failed to load details.')
    } finally {
      setDetailBusy(false)
    }
  }

  function closeDetail() {
    setDetailOpen(false)
    setSelectedRecordId(null)
    setDetail(null)
    setDetailError(null)
    setDetailBusy(false)
  }

  useEffect(() => {
    void loadRecords(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClubId])

  const exportUrl = useMemo(() => {
    const search = buildSearchParams(filters)
    return `/api/clubs/${activeClubId}/finance/invoices/export?${search.toString()}`
  }, [activeClubId, filters])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void loadRecords(filters)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Finance & Invoices</h2>
      <p className="text-sm text-[var(--muted)]">
        Club-level invoices and receipts for operations, tax, and accounting retrieval.
      </p>

      <div className="grid gap-3 md:grid-cols-4">
        <article className="panel-strong p-3 text-sm">
          <p className="text-xs text-[var(--muted)]">Documents</p>
          <p className="text-xl font-semibold">{summary.totalDocuments}</p>
        </article>
        <article className="panel-strong p-3 text-sm">
          <p className="text-xs text-[var(--muted)]">Total amount</p>
          <p className="text-xl font-semibold">{formatMoney(summary.totalAmountCents, 'KZT')}</p>
        </article>
        <article className="panel-strong p-3 text-sm">
          <p className="text-xs text-[var(--muted)]">Paid amount</p>
          <p className="text-xl font-semibold">{formatMoney(summary.paidAmountCents, 'KZT')}</p>
        </article>
        <article className="panel-strong p-3 text-sm">
          <p className="text-xs text-[var(--muted)]">Pending amount</p>
          <p className="text-xl font-semibold">{formatMoney(summary.pendingAmountCents, 'KZT')}</p>
        </article>
      </div>

      <form onSubmit={applyFilters} className="panel-strong space-y-3 p-4 text-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="flex flex-col gap-1">
            Source
            <select
              className="panel rounded-lg px-3 py-2"
              value={filters.source}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  source: event.target.value as FiltersState['source'],
                }))
              }
            >
              <option value="ALL">All</option>
              <option value="INVOICE">Invoices</option>
              <option value="RECEIPT">Receipts</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Status
            <select
              className="panel rounded-lg px-3 py-2"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value,
                }))
              }
            >
              <option value="">All</option>
              <option value="PAID">PAID</option>
              <option value="PENDING">PENDING</option>
              <option value="REFUNDED">REFUNDED</option>
              <option value="ISSUED">ISSUED</option>
              <option value="VOID">VOID</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Search
            <input
              className="panel rounded-lg px-3 py-2"
              value={filters.q}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  q: event.target.value,
                }))
              }
              placeholder="Invoice, booking, customer"
            />
          </label>
          <label className="flex flex-col gap-1">
            Date from
            <input
              type="date"
              className="panel rounded-lg px-3 py-2"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateFrom: event.target.value,
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            Date to
            <input
              type="date"
              className="panel rounded-lg px-3 py-2"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  dateTo: event.target.value,
                }))
              }
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10 disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Apply filters'}
          </button>
          <a
            href={exportUrl}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10"
          >
            Export CSV
          </a>
        </div>
      </form>

      {error ? <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}

      {loading ? <p className="text-sm text-[var(--muted)]">Loading finance documents...</p> : null}

      {!loading && !error && records.length === 0 ? (
        <article className="panel-strong p-4 text-sm text-[var(--muted)]">
          No invoices or receipts found for current filters.
        </article>
      ) : null}

      {!loading && !error && records.length > 0 ? (
        <div className="space-y-2">
          {records.map((record) => (
            <article key={record.recordId} className="panel-strong space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {record.invoiceNumber} · {record.sourceType} · {record.documentStatus}
                </p>
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {new Date(record.issuedAt).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Booking #{record.bookingId || 'N/A'} · {record.guestName || 'N/A'} · {record.roomName || 'N/A'}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {record.method} · Payment state: {record.paymentState}
              </p>
              <p className="text-sm font-semibold">{formatMoney(record.amountCents, record.currency)}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                  onClick={() => void loadDetail(record.recordId)}
                >
                  Open details
                </button>
                <a
                  href={`/api/clubs/${activeClubId}/finance/invoices/${record.recordId}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  View PDF/Print
                </a>
                <a
                  href={`/api/clubs/${activeClubId}/finance/invoices/${record.recordId}/pdf?download=1`}
                  className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                >
                  Download
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {detailOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeDetail}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border p-5 text-sm shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
            style={modalSurfaceStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div>
                <h3 className="text-xl font-semibold">Document Details</h3>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {selectedRecordId || 'N/A'}
                </p>
              </div>
              <button
                type="button"
                className="ml-auto rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-white/10"
                onClick={closeDetail}
              >
                Close
              </button>
            </div>

            {detailBusy ? <p className="text-[var(--muted)]">Loading details...</p> : null}
            {detailError ? <p className="text-rose-700 dark:text-rose-300">{detailError}</p> : null}

            {!detailBusy && !detailError && detail ? (
              <div className="space-y-4">
                <section className="rounded-xl border p-4" style={modalSectionStyle}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold">{detail.invoiceNumber}</p>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                      {detail.sourceType}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                      {detail.documentStatus}
                    </span>
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                      {detail.paymentState}
                    </span>
                    <span className="ml-auto text-base font-semibold">
                      {formatMoney(detail.totalCents, detail.currency)}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <p className="text-xs text-[var(--muted)]">Issued at</p>
                      <p>{formatDateTime(detail.issueDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Method</p>
                      <p>{detail.method}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Provider ref</p>
                      <p>{detail.providerRef || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Order number</p>
                      <p>{detail.orderNumber || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Invoice ID</p>
                      <p>{detail.invoiceId || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--muted)]">Payment ID</p>
                      <p>{detail.paymentId || 'N/A'}</p>
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2">
                  <article className="rounded-xl border p-4" style={modalSectionStyle}>
                    <p className="mb-2 text-sm font-semibold">Customer</p>
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-[var(--muted)]">Name</p>
                        <p>{detail.customer.name || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Email</p>
                        <p>{detail.customer.email || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Phone</p>
                        <p>{detail.customer.phone || 'N/A'}</p>
                      </div>
                    </div>
                  </article>

                  <article className="rounded-xl border p-4" style={modalSectionStyle}>
                    <p className="mb-2 text-sm font-semibold">Financial Breakdown</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--muted)]">Subtotal</span>
                        <span>{formatMoney(detail.subtotalCents, detail.currency)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--muted)]">Discount</span>
                        <span>{formatMoney(detail.discountTotalCents, detail.currency)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--muted)]">Tax</span>
                        <span>{formatMoney(detail.taxTotalCents, detail.currency)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 font-semibold">
                        <span>Total</span>
                        <span>{formatMoney(detail.totalCents, detail.currency)}</span>
                      </div>
                    </div>
                  </article>
                </section>

                <section className="rounded-xl border p-4" style={modalSectionStyle}>
                  <p className="mb-2 text-sm font-semibold">Booking Context</p>
                  {detail.booking ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p className="text-xs text-[var(--muted)]">Booking</p>
                        <p>#{detail.booking.id}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Booking status</p>
                        <p>{detail.booking.status}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Payment status</p>
                        <p>{detail.booking.paymentStatus}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Session start</p>
                        <p>{formatDateTime(detail.booking.checkIn)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Session end</p>
                        <p>{formatDateTime(detail.booking.checkOut)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Seat</p>
                        <p>{detail.booking.seatLabel || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Room</p>
                        <p>{detail.booking.roomName || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Club</p>
                        <p>{detail.booking.clubName || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--muted)]">Location</p>
                        <p>{[detail.booking.clubCity, detail.booking.clubAddress].filter(Boolean).join(', ') || 'N/A'}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[var(--muted)]">No linked booking data.</p>
                  )}
                </section>

                <section className="rounded-xl border p-4" style={modalSectionStyle}>
                  <p className="mb-2 text-sm font-semibold">Line Items</p>
                  {detail.lineItems.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-xs">
                        <thead>
                          <tr className="text-left text-[var(--muted)]">
                            <th className="pb-2">Item</th>
                            <th className="pb-2">Type</th>
                            <th className="pb-2 text-right">Qty</th>
                            <th className="pb-2 text-right">Unit</th>
                            <th className="pb-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.lineItems.map((line, index) => (
                            <tr key={`${line.type}-${index}`} className="border-t border-[var(--border)]">
                              <td className="py-2 pr-2">{line.title}</td>
                              <td className="py-2 pr-2">{line.type}</td>
                              <td className="py-2 pr-2 text-right">{line.quantity}</td>
                              <td className="py-2 pr-2 text-right">
                                {formatMoney(line.unitAmountCents, detail.currency)}
                              </td>
                              <td className="py-2 text-right font-medium">
                                {formatMoney(line.totalAmountCents, detail.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[var(--muted)]">No line items available.</p>
                  )}
                </section>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                  <a
                    href={`/api/clubs/${activeClubId}/finance/invoices/${detail.recordId}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10"
                  >
                    View PDF/Print
                  </a>
                  <a
                    href={`/api/clubs/${activeClubId}/finance/invoices/${detail.recordId}/pdf?download=1`}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    className="ml-auto rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10"
                    onClick={closeDetail}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
