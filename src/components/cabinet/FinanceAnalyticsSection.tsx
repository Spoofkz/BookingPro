'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type FinanceOverview = {
  range: {
    from: string
    to: string
    timezone: string
    days: number
  }
  currency: string
  kpis: {
    grossSalesCents: number
    netSalesCents: number
    collectedCents: number
    outstandingCents: number
    discountCents: number
    avgTicketCents: number
    transactionsCount: number
    cancellationCount: number
    noShowCount: number
    estimatedLostRevenueCents: number
    deferredLiabilityCents: number
  }
  paymentSplit: Array<{
    method: 'CASH' | 'POS' | 'ONLINE' | 'WALLET'
    amountCents: number
    transactions: number
  }>
  hourlyRevenue: Array<{
    hour: number
    amountCents: number
    transactions: number
  }>
  revenueByDay: Array<{
    date: string
    amountCents: number
    transactions: number
  }>
  occupancy: {
    seatCount: number
    seatHoursAvailable: number
    seatHoursBooked: number
    utilizationPct: number
  }
  promoImpact: {
    discountedOrdersCount: number
    discountAmountCents: number
    topPromoCodes: Array<{
      code: string
      uses: number
    }>
  }
}

type RevenueBreakdown = {
  groupBy: 'day' | 'hour' | 'segment'
  buckets: Array<{
    key: string
    label: string
    amountCents: number
    transactions: number
  }>
}

type OccupancyBreakdown = {
  groupBy: 'day' | 'hour'
  seatCount: number
  buckets: Array<{
    key: string
    label: string
    seatHoursAvailable: number
    seatHoursBooked: number
    utilizationPct: number
  }>
}

type InvoiceSummary = {
  totals: {
    documents: number
    invoices: number
    receipts: number
    issuedAmountCents: number
    avgInvoiceCents: number
    paidAmountCents: number
    pendingAmountCents: number
  }
  aging: {
    bucket_1_2_days: number
    bucket_3_7_days: number
    bucket_7_plus_days: number
  }
}

type Shift = {
  shiftId: string
  status: 'OPEN' | 'CLOSED'
  openedAt: string
  closedAt: string | null
  cashierName: string | null
  terminalLabel: string | null
  startingCashCents: number
  expectedCashCents: number
  actualCashCents: number | null
  discrepancyCents: number | null
  requiresOwnerApproval: boolean
}

type ShiftResponse = {
  shifts: Shift[]
  openShift: Shift | null
}

type LiabilitySummary = {
  asOf: string
  totalDeferredCents: number
  expiringIn7DaysCents: number
  expiringIn30DaysCents: number
  byType: Array<{
    type: string
    deferredCents: number
    entitlements: number
  }>
  weeklyConsumption: {
    amountDelta: number
    minutesDelta: number
    sessionsDelta: number
  }
}

type Forecast = {
  generatedAt: string
  horizonDays: number
  scenario: {
    horizonDays: number
    priceChangePct: number
    promoDiscountPct: number
    extendedHoursPct: number
    extraBootcampSessionsPerDay: number
  }
  totals: {
    revenueCents: number
    bookings: number
    avgUtilizationPct: number
  }
  points: Array<{
    date: string
    expectedRevenueCents: number
    expectedBookings: number
    expectedUtilizationPct: number
    lowRevenueCents: number
    highRevenueCents: number
  }>
}

type ForecastListResponse = {
  items: Forecast[]
}

function toDateInputValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60 * 1000
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 10)
}

function formatMoney(amount: number) {
  const normalized = Math.trunc(Number.isFinite(amount) ? amount : 0)
  const sign = normalized < 0 ? '-' : ''
  const abs = Math.abs(normalized)
  return `${sign}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(abs)} KZT`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0)
}

function formatPercent(value: number) {
  return `${Math.round(value * 100) / 100}%`
}

function formatDateTime(value: string | null) {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function buildRangeQuery(filters: { from: string; to: string }) {
  const search = new URLSearchParams()
  if (filters.from) search.set('from', filters.from)
  if (filters.to) search.set('to', filters.to)
  return search.toString()
}

async function readJson<T>(response: Response, fallback: string) {
  const payload = (await response.json()) as T | { error?: string }
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error || fallback)
  }
  return payload as T
}

export default function FinanceAnalyticsSection({ activeClubId }: { activeClubId: string }) {
  const [range, setRange] = useState(() => {
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return {
      from: toDateInputValue(from),
      to: toDateInputValue(now),
    }
  })
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [revenue, setRevenue] = useState<RevenueBreakdown | null>(null)
  const [occupancy, setOccupancy] = useState<OccupancyBreakdown | null>(null)
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null)
  const [shifts, setShifts] = useState<ShiftResponse | null>(null)
  const [liability, setLiability] = useState<LiabilitySummary | null>(null)
  const [forecastHistory, setForecastHistory] = useState<Forecast[]>([])
  const [forecastResult, setForecastResult] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)

  const [openShiftForm, setOpenShiftForm] = useState({
    startingCashKzt: '0',
    cashierName: '',
    terminalLabel: '',
  })
  const [closeShiftForm, setCloseShiftForm] = useState({
    actualCashKzt: '',
    closeNote: '',
  })
  const [scenario, setScenario] = useState({
    horizonDays: '30',
    priceChangePct: '0',
    promoDiscountPct: '0',
    extendedHoursPct: '0',
    extraBootcampSessionsPerDay: '0',
  })

  const rangeQuery = useMemo(() => buildRangeQuery(range), [range])

  const requestHeaders = useMemo(
    () => ({
      'X-Club-Id': activeClubId,
      'Content-Type': 'application/json',
    }),
    [activeClubId],
  )

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [overviewResponse, revenueResponse, occupancyResponse, invoiceResponse, shiftResponse, liabilityResponse, forecastResponse] =
        await Promise.all([
          fetch(`/api/clubs/${activeClubId}/finance/overview?${rangeQuery}`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/revenue?${rangeQuery}&groupBy=day`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/occupancy?${rangeQuery}&groupBy=day`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/invoices/summary?${rangeQuery}`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/shifts?${rangeQuery}`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/packs/liability`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
          fetch(`/api/clubs/${activeClubId}/finance/forecast`, {
            cache: 'no-store',
            headers: { 'X-Club-Id': activeClubId },
          }),
        ])

      const [
        overviewPayload,
        revenuePayload,
        occupancyPayload,
        invoicePayload,
        shiftPayload,
        liabilityPayload,
        forecastPayload,
      ] = await Promise.all([
        readJson<FinanceOverview>(overviewResponse, 'Failed to load finance overview.'),
        readJson<RevenueBreakdown>(revenueResponse, 'Failed to load revenue analytics.'),
        readJson<OccupancyBreakdown>(occupancyResponse, 'Failed to load occupancy analytics.'),
        readJson<InvoiceSummary>(invoiceResponse, 'Failed to load invoice analytics.'),
        readJson<ShiftResponse>(shiftResponse, 'Failed to load shifts.'),
        readJson<LiabilitySummary>(liabilityResponse, 'Failed to load pack liability.'),
        readJson<ForecastListResponse>(forecastResponse, 'Failed to load forecast snapshots.'),
      ])

      setOverview(overviewPayload)
      setRevenue(revenuePayload)
      setOccupancy(occupancyPayload)
      setInvoiceSummary(invoicePayload)
      setShifts(shiftPayload)
      setLiability(liabilityPayload)
      setForecastHistory(forecastPayload.items || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load finance analytics.')
    } finally {
      setLoading(false)
    }
  }, [activeClubId, rangeQuery])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function handleOpenShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyAction('open-shift')
    setActionMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/finance/shifts/open`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          startingCashCents: Math.max(0, Math.round(Number(openShiftForm.startingCashKzt || '0'))),
          cashierName: openShiftForm.cashierName,
          terminalLabel: openShiftForm.terminalLabel,
        }),
      })
      await readJson(response, 'Failed to open shift.')
      setActionMessage('Shift opened.')
      await loadAll()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to open shift.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCloseShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!shifts?.openShift) return
    setBusyAction('close-shift')
    setActionMessage(null)
    setError(null)
    try {
      const response = await fetch(
        `/api/clubs/${activeClubId}/finance/shifts/${shifts.openShift.shiftId}/close`,
        {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({
            actualCashCents: Math.max(0, Math.round(Number(closeShiftForm.actualCashKzt || '0'))),
            closeNote: closeShiftForm.closeNote,
          }),
        },
      )
      await readJson(response, 'Failed to close shift.')
      setActionMessage('Shift closed.')
      setCloseShiftForm({ actualCashKzt: '', closeNote: '' })
      await loadAll()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to close shift.')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRunForecast(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyAction('forecast')
    setActionMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/clubs/${activeClubId}/finance/forecast/run`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({
          horizonDays: Number(scenario.horizonDays || '30'),
          priceChangePct: Number(scenario.priceChangePct || '0'),
          promoDiscountPct: Number(scenario.promoDiscountPct || '0'),
          extendedHoursPct: Number(scenario.extendedHoursPct || '0'),
          extraBootcampSessionsPerDay: Number(scenario.extraBootcampSessionsPerDay || '0'),
        }),
      })
      const payload = await readJson<Forecast>(response, 'Failed to run forecast.')
      setForecastResult(payload)
      setActionMessage('Forecast snapshot generated.')
      await loadAll()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to run forecast.')
    } finally {
      setBusyAction(null)
    }
  }

  const maxHourlyRevenue = useMemo(() => {
    if (!overview) return 0
    return overview.hourlyRevenue.reduce((max, row) => Math.max(max, row.amountCents), 0)
  }, [overview])

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Finance & Analytics (Owner)</h2>
        <p className="text-sm text-[var(--muted)]">
          Cash flow, revenue, occupancy, pack liability, shifts, and forecasting for the active club.
        </p>
      </header>

      <form
        className="panel-strong flex flex-wrap items-end gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void loadAll()
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          From
          <input
            className="panel rounded-lg px-3 py-2 text-sm"
            type="date"
            value={range.from}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          To
          <input
            className="panel rounded-lg px-3 py-2 text-sm"
            type="date"
            value={range.to}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <button className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-white/10" type="submit">
          Refresh
        </button>
        <a
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-white/10"
          href={`/api/clubs/${activeClubId}/finance/export?report=overview&${rangeQuery}`}
        >
          Export overview CSV
        </a>
        <a
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-white/10"
          href={`/api/clubs/${activeClubId}/finance/export?report=revenue&${rangeQuery}`}
        >
          Export revenue CSV
        </a>
      </form>

      {loading ? <p className="text-sm text-[var(--muted)]">Loading finance dashboard...</p> : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {actionMessage ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{actionMessage}</p> : null}

      {overview ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article className="panel-strong p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Net Sales</p>
            <p className="mt-2 text-2xl font-semibold">{formatMoney(overview.kpis.netSalesCents)}</p>
            <p className="text-xs text-[var(--muted)]">Gross: {formatMoney(overview.kpis.grossSalesCents)}</p>
          </article>
          <article className="panel-strong p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Collected</p>
            <p className="mt-2 text-2xl font-semibold">{formatMoney(overview.kpis.collectedCents)}</p>
            <p className="text-xs text-[var(--muted)]">Outstanding: {formatMoney(overview.kpis.outstandingCents)}</p>
          </article>
          <article className="panel-strong p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Avg Ticket</p>
            <p className="mt-2 text-2xl font-semibold">{formatMoney(overview.kpis.avgTicketCents)}</p>
            <p className="text-xs text-[var(--muted)]">
              Transactions: {formatNumber(overview.kpis.transactionsCount)}
            </p>
          </article>
          <article className="panel-strong p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Utilization</p>
            <p className="mt-2 text-2xl font-semibold">{formatPercent(overview.occupancy.utilizationPct)}</p>
            <p className="text-xs text-[var(--muted)]">Seat-hours booked: {overview.occupancy.seatHoursBooked}</p>
          </article>
        </section>
      ) : null}

      {overview ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <article className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Payment Method Split</h3>
            {overview.paymentSplit.map((row) => (
              <div key={row.method} className="flex items-center justify-between text-sm">
                <span>{row.method}</span>
                <span>
                  {formatMoney(row.amountCents)} · {formatNumber(row.transactions)}
                </span>
              </div>
            ))}
          </article>
          <article className="panel-strong space-y-3 p-4">
            <h3 className="text-lg font-semibold">Hourly Revenue Heat</h3>
            <div className="space-y-2">
              {overview.hourlyRevenue.map((row) => {
                const width = maxHourlyRevenue > 0 ? Math.round((row.amountCents / maxHourlyRevenue) * 100) : 0
                return (
                  <div key={row.hour} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>{String(row.hour).padStart(2, '0')}:00</span>
                      <span>{formatMoney(row.amountCents)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[color-mix(in_oklab,var(--background)_85%,var(--foreground)_15%)]">
                      <div
                        className="h-2 rounded-full bg-[color-mix(in_oklab,var(--accent)_75%,#ffffff_25%)]"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </article>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Revenue by Day</h3>
          {revenue ? (
            <div className="max-h-72 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-right">Revenue</th>
                    <th className="px-2 py-1 text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.buckets.map((bucket) => (
                    <tr key={bucket.key} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1">{bucket.label}</td>
                      <td className="px-2 py-1 text-right">{formatMoney(bucket.amountCents)}</td>
                      <td className="px-2 py-1 text-right">{formatNumber(bucket.transactions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No revenue data.</p>
          )}
        </article>

        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Occupancy by Day</h3>
          {occupancy ? (
            <div className="max-h-72 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-right">Booked</th>
                    <th className="px-2 py-1 text-right">Available</th>
                    <th className="px-2 py-1 text-right">Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {occupancy.buckets.map((bucket) => (
                    <tr key={bucket.key} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1">{bucket.label}</td>
                      <td className="px-2 py-1 text-right">{bucket.seatHoursBooked}</td>
                      <td className="px-2 py-1 text-right">{bucket.seatHoursAvailable}</td>
                      <td className="px-2 py-1 text-right">{formatPercent(bucket.utilizationPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No occupancy data.</p>
          )}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Invoice & Receipt Analytics</h3>
          {invoiceSummary ? (
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Documents</span>
                <span>{formatNumber(invoiceSummary.totals.documents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Issued total</span>
                <span>{formatMoney(invoiceSummary.totals.issuedAmountCents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Paid total</span>
                <span>{formatMoney(invoiceSummary.totals.paidAmountCents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pending total</span>
                <span>{formatMoney(invoiceSummary.totals.pendingAmountCents)}</span>
              </div>
              <div className="pt-2 text-xs text-[var(--muted)]">
                Aging: 1-2d {invoiceSummary.aging.bucket_1_2_days} · 3-7d {invoiceSummary.aging.bucket_3_7_days} · 7+d{' '}
                {invoiceSummary.aging.bucket_7_plus_days}
              </div>
              <a
                className="inline-flex w-fit rounded-lg border border-[var(--border)] px-3 py-2 text-xs hover:bg-white/10"
                href={`/cabinet/tech/payments`}
              >
                Open invoice details
              </a>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No invoice analytics.</p>
          )}
        </article>

        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Packs & Wallet Liability</h3>
          {liability ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Total deferred</span>
                <strong>{formatMoney(liability.totalDeferredCents)}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Expiring in 7 days</span>
                <span>{formatMoney(liability.expiringIn7DaysCents)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Expiring in 30 days</span>
                <span>{formatMoney(liability.expiringIn30DaysCents)}</span>
              </div>
              <div className="pt-2 text-xs text-[var(--muted)]">
                Weekly consumption: amount {liability.weeklyConsumption.amountDelta}, minutes {liability.weeklyConsumption.minutesDelta}, sessions{' '}
                {liability.weeklyConsumption.sessionsDelta}
              </div>
              <div className="space-y-1">
                {liability.byType.map((row) => (
                  <div key={row.type} className="flex items-center justify-between text-xs">
                    <span>{row.type}</span>
                    <span>
                      {formatMoney(row.deferredCents)} · {row.entitlements}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">No liability data.</p>
          )}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Cash Desk / Shifts</h3>
          <form className="grid gap-2 md:grid-cols-3" onSubmit={handleOpenShift}>
            <input
              className="panel rounded-lg px-3 py-2 text-sm"
              type="number"
              min="0"
              step="1"
              placeholder="Start cash (KZT)"
              value={openShiftForm.startingCashKzt}
              onChange={(event) =>
                setOpenShiftForm((current) => ({ ...current, startingCashKzt: event.target.value }))
              }
            />
            <input
              className="panel rounded-lg px-3 py-2 text-sm"
              placeholder="Cashier"
              value={openShiftForm.cashierName}
              onChange={(event) =>
                setOpenShiftForm((current) => ({ ...current, cashierName: event.target.value }))
              }
            />
            <input
              className="panel rounded-lg px-3 py-2 text-sm"
              placeholder="Terminal label"
              value={openShiftForm.terminalLabel}
              onChange={(event) =>
                setOpenShiftForm((current) => ({ ...current, terminalLabel: event.target.value }))
              }
            />
            <button
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              type="submit"
              disabled={busyAction === 'open-shift'}
            >
              {busyAction === 'open-shift' ? 'Opening...' : 'Open shift'}
            </button>
          </form>

          {shifts?.openShift ? (
            <form className="grid gap-2 md:grid-cols-3" onSubmit={handleCloseShift}>
              <input
                className="panel rounded-lg px-3 py-2 text-sm"
                type="number"
                min="0"
                step="1"
                placeholder="Actual cash (KZT)"
                value={closeShiftForm.actualCashKzt}
                onChange={(event) =>
                  setCloseShiftForm((current) => ({ ...current, actualCashKzt: event.target.value }))
                }
              />
              <input
                className="panel rounded-lg px-3 py-2 text-sm md:col-span-2"
                placeholder="Close note"
                value={closeShiftForm.closeNote}
                onChange={(event) =>
                  setCloseShiftForm((current) => ({ ...current, closeNote: event.target.value }))
                }
              />
              <button
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                type="submit"
                disabled={busyAction === 'close-shift'}
              >
                {busyAction === 'close-shift' ? 'Closing...' : 'Close shift'}
              </button>
            </form>
          ) : null}

          <div className="max-h-72 overflow-auto text-sm">
            {shifts?.shifts.length ? (
              shifts.shifts.map((shift) => (
                <article key={shift.shiftId} className="mt-2 rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between">
                    <strong>{shift.status}</strong>
                    <span className="text-xs text-[var(--muted)]">{shift.shiftId.slice(0, 18)}</span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    Opened: {formatDateTime(shift.openedAt)} · Closed: {formatDateTime(shift.closedAt)}
                  </p>
                  <p className="text-xs">
                    Start: {formatMoney(shift.startingCashCents)} · Expected cash flow:{' '}
                    {formatMoney(shift.expectedCashCents)}
                  </p>
                  <p className="text-xs">
                    Actual: {formatMoney(shift.actualCashCents || 0)} · Discrepancy:{' '}
                    {shift.discrepancyCents != null ? formatMoney(shift.discrepancyCents) : 'N/A'}
                  </p>
                  {shift.requiresOwnerApproval ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">Owner approval required.</p>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No shifts in this range.</p>
            )}
          </div>
        </article>

        <article className="panel-strong space-y-3 p-4">
          <h3 className="text-lg font-semibold">Forecast & What-if</h3>
          <form className="grid gap-2 md:grid-cols-2" onSubmit={handleRunForecast}>
            <label className="text-xs text-[var(--muted)]">
              Horizon days
              <input
                className="panel mt-1 w-full rounded-lg px-3 py-2 text-sm"
                type="number"
                min="1"
                max="90"
                value={scenario.horizonDays}
                onChange={(event) =>
                  setScenario((current) => ({ ...current, horizonDays: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Price change %
              <input
                className="panel mt-1 w-full rounded-lg px-3 py-2 text-sm"
                type="number"
                value={scenario.priceChangePct}
                onChange={(event) =>
                  setScenario((current) => ({ ...current, priceChangePct: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Promo discount %
              <input
                className="panel mt-1 w-full rounded-lg px-3 py-2 text-sm"
                type="number"
                value={scenario.promoDiscountPct}
                onChange={(event) =>
                  setScenario((current) => ({ ...current, promoDiscountPct: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Extended hours %
              <input
                className="panel mt-1 w-full rounded-lg px-3 py-2 text-sm"
                type="number"
                value={scenario.extendedHoursPct}
                onChange={(event) =>
                  setScenario((current) => ({ ...current, extendedHoursPct: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-[var(--muted)] md:col-span-2">
              Extra bootcamp sessions/day
              <input
                className="panel mt-1 w-full rounded-lg px-3 py-2 text-sm"
                type="number"
                min="0"
                value={scenario.extraBootcampSessionsPerDay}
                onChange={(event) =>
                  setScenario((current) => ({
                    ...current,
                    extraBootcampSessionsPerDay: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
              type="submit"
              disabled={busyAction === 'forecast'}
            >
              {busyAction === 'forecast' ? 'Running...' : 'Run forecast'}
            </button>
            <a
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/10 text-center"
              href={`/api/clubs/${activeClubId}/finance/export?report=forecast`}
            >
              Export forecast CSV
            </a>
          </form>

          {forecastResult ? (
            <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <p>
                Forecast total: <strong>{formatMoney(forecastResult.totals.revenueCents)}</strong> · Bookings:{' '}
                {formatNumber(forecastResult.totals.bookings)} · Avg utilization:{' '}
                {formatPercent(forecastResult.totals.avgUtilizationPct)}
              </p>
            </div>
          ) : null}

          <div className="max-h-72 overflow-auto text-sm">
            {(forecastResult || forecastHistory[0])?.points?.slice(0, 14).map((point) => (
              <div key={point.date} className="flex items-center justify-between border-t border-[var(--border)] py-1">
                <span>{point.date}</span>
                <span>
                  {formatMoney(point.expectedRevenueCents)} · {formatNumber(point.expectedBookings)} bookings
                </span>
              </div>
            ))}
            {!forecastResult && forecastHistory.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No forecast snapshots yet.</p>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  )
}
