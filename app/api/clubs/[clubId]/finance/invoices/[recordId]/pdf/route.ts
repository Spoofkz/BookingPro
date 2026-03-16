import { NextRequest, NextResponse } from 'next/server'
import {
  AuthorizationError,
  requirePermissionInClub,
} from '@/src/lib/authorization'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { getClubFinanceRecordDetail } from '@/src/lib/financeRecords'
import { prisma } from '@/src/lib/prisma'
import { PERMISSIONS } from '@/src/lib/rbac'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ clubId: string; recordId: string }>
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMoney(amountKzt: number, _currency: string) {
  const rounded = Math.max(0, Math.trunc(amountKzt))
  try {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(rounded)} KZT`
  } catch {
    return `${rounded} KZT`
  }
}

function renderHtml(detail: Awaited<ReturnType<typeof getClubFinanceRecordDetail>>) {
  if (!detail) return ''

  const bookingSession = detail.booking
    ? `${escapeHtml(new Date(detail.booking.checkIn).toLocaleString())} - ${escapeHtml(
        new Date(detail.booking.checkOut).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      )}`
    : 'N/A'

  const lineRows = detail.lineItems
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.title)}</td>
        <td style="text-align:center">${line.quantity}</td>
        <td style="text-align:right">${escapeHtml(formatMoney(line.unitAmountCents, detail.currency))}</td>
        <td style="text-align:right">${escapeHtml(formatMoney(line.totalAmountCents, detail.currency))}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(detail.invoiceNumber)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
      .wrap { max-width: 860px; margin: 0 auto; }
      h1 { margin: 0 0 10px; font-size: 24px; }
      .muted { color: #666; font-size: 12px; }
      .box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 14px 0; }
      .row { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #eee; padding: 8px; font-size: 13px; }
      th { text-align: left; }
      .totals td { font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Booking Finance Document</h1>
      <p class="muted">${escapeHtml(detail.sourceType)} · ${escapeHtml(detail.invoiceNumber)}</p>

      <div class="box">
        <div class="row"><span>Issued</span><strong>${escapeHtml(new Date(detail.issueDate).toLocaleString())}</strong></div>
        <div class="row"><span>Document status</span><strong>${escapeHtml(detail.documentStatus)}</strong></div>
        <div class="row"><span>Payment state</span><strong>${escapeHtml(detail.paymentState)}</strong></div>
        <div class="row"><span>Method</span><strong>${escapeHtml(detail.method)}</strong></div>
        <div class="row"><span>Total</span><strong>${escapeHtml(formatMoney(detail.totalCents, detail.currency))}</strong></div>
      </div>

      <div class="box">
        <div class="row"><span>Customer</span><strong>${escapeHtml(detail.customer.name || 'N/A')}</strong></div>
        <div class="row"><span>Email</span><strong>${escapeHtml(detail.customer.email || 'N/A')}</strong></div>
        <div class="row"><span>Phone</span><strong>${escapeHtml(detail.customer.phone || 'N/A')}</strong></div>
        <div class="row"><span>Order</span><strong>${escapeHtml(detail.orderNumber || 'N/A')}</strong></div>
      </div>

      <div class="box">
        <div class="row"><span>Booking ID</span><strong>${detail.booking ? `#${detail.booking.id}` : 'N/A'}</strong></div>
        <div class="row"><span>Club</span><strong>${escapeHtml(detail.booking?.clubName || 'N/A')}</strong></div>
        <div class="row"><span>Location</span><strong>${escapeHtml([detail.booking?.clubCity, detail.booking?.clubAddress].filter(Boolean).join(', ') || 'N/A')}</strong></div>
        <div class="row"><span>Room</span><strong>${escapeHtml(detail.booking?.roomName || 'N/A')}</strong></div>
        <div class="row"><span>Seat</span><strong>${escapeHtml(detail.booking?.seatLabel || 'N/A')}</strong></div>
        <div class="row"><span>Session</span><strong>${bookingSession}</strong></div>
      </div>

      <div class="box">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align:center">Qty</th>
              <th style="text-align:right">Unit</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineRows}
          </tbody>
        </table>
        <table style="margin-top: 10px">
          <tbody>
            <tr class="totals"><td>Subtotal</td><td style="text-align:right">${escapeHtml(
              formatMoney(detail.subtotalCents, detail.currency),
            )}</td></tr>
            <tr class="totals"><td>Discount</td><td style="text-align:right">${escapeHtml(
              formatMoney(detail.discountTotalCents, detail.currency),
            )}</td></tr>
            <tr class="totals"><td>Tax</td><td style="text-align:right">${escapeHtml(
              formatMoney(detail.taxTotalCents, detail.currency),
            )}</td></tr>
            <tr class="totals"><td>Grand total</td><td style="text-align:right">${escapeHtml(
              formatMoney(detail.totalCents, detail.currency),
            )}</td></tr>
          </tbody>
        </table>
      </div>

      <p class="muted">Generated by Booking Project finance module.</p>
    </div>
  </body>
</html>`
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const { clubId, recordId } = await routeContext.params
  const download = request.nextUrl.searchParams.get('download') === '1'

  try {
    const context = await getCabinetContext({ requireSession: true })
    requirePermissionInClub(context, clubId, PERMISSIONS.CLUB_READ)

    const detail = await getClubFinanceRecordDetail({
      clubId,
      recordId,
    })
    if (!detail) {
      return NextResponse.json({ error: 'Finance document not found.' }, { status: 404 })
    }

    await prisma.auditLog.create({
      data: {
        clubId,
        actorUserId: context.userId,
        action: 'finance.invoice.downloaded',
        entityType: 'finance_document',
        entityId: detail.recordId,
        ...(detail.booking ? { bookingId: detail.booking.id } : {}),
        metadata: JSON.stringify({
          sourceType: detail.sourceType,
          invoiceNumber: detail.invoiceNumber,
          format: 'html',
        }),
      },
    })

    const html = renderHtml(detail)

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${detail.invoiceNumber}.html"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}

