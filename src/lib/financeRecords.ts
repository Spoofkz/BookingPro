import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export type FinanceSourceType = 'INVOICE' | 'RECEIPT'

export type FinanceListFilters = {
  source?: 'ALL' | FinanceSourceType
  status?: string | null
  query?: string | null
  dateFrom?: Date | null
  dateTo?: Date | null
  page?: number
  pageSize?: number
}

export type FinanceSummary = {
  totalDocuments: number
  totalAmountCents: number
  invoiceDocuments: number
  receiptDocuments: number
  paidAmountCents: number
  pendingAmountCents: number
  refundedAmountCents: number
}

export type FinanceListItem = {
  recordId: string
  sourceType: FinanceSourceType
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

export type FinanceDetailItem = {
  title: string
  quantity: number
  unitAmountCents: number
  totalAmountCents: number
  type: string
}

export type FinanceDetail = {
  recordId: string
  sourceType: FinanceSourceType
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
  lineItems: FinanceDetailItem[]
}

function parsePriceSnapshot(snapshot: string | null | undefined) {
  if (!snapshot) return null
  try {
    return JSON.parse(snapshot) as {
      lineItems?: Array<{
        title?: string
        amount?: number
        amountCents?: number
        type?: string
      }>
      breakdown?: Array<{
        label?: string
        amount?: number
        type?: string
      }>
      total?: number
      totalCents?: number
    }
  } catch {
    return null
  }
}

function toCurrency(value: string | null | undefined) {
  const normalized = (value || '').trim().toUpperCase()
  return normalized || 'KZT'
}

function toRecordId(sourceType: FinanceSourceType, id: string | number) {
  return sourceType === 'INVOICE' ? `inv_${id}` : `pay_${id}`
}

export function parseFinanceRecordId(recordId: string) {
  const trimmed = recordId.trim()
  if (trimmed.startsWith('inv_')) {
    const id = trimmed.slice(4)
    if (!id) return null
    return { sourceType: 'INVOICE' as const, invoiceId: id, paymentId: null }
  }
  if (trimmed.startsWith('pay_')) {
    const rawPaymentId = Number(trimmed.slice(4))
    if (!Number.isInteger(rawPaymentId) || rawPaymentId < 1) return null
    return { sourceType: 'RECEIPT' as const, invoiceId: null, paymentId: rawPaymentId }
  }
  return null
}

function normalizeFinanceStatuses(params: {
  documentStatus: string
  paymentState: string
}) {
  return {
    documentStatus: params.documentStatus.toUpperCase(),
    paymentState: params.paymentState.toUpperCase(),
  }
}

function statusMatches(params: {
  requestedStatus: string | null
  documentStatus: string
  paymentState: string
}) {
  const requested = (params.requestedStatus || '').trim().toUpperCase()
  if (!requested) return true
  if (requested === 'ISSUED' || requested === 'VOID') {
    return params.documentStatus.toUpperCase() === requested
  }
  if (requested === 'PAID' || requested === 'PENDING' || requested === 'REFUNDED') {
    return params.paymentState.toUpperCase() === requested
  }
  return params.documentStatus.toUpperCase() === requested || params.paymentState.toUpperCase() === requested
}

function queryMatches(record: FinanceListItem, query: string | null) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return true
  const haystack = [
    record.invoiceNumber,
    record.orderNumber || '',
    record.guestName || '',
    record.guestEmail || '',
    record.roomName || '',
    record.bookingId != null ? String(record.bookingId) : '',
    record.method,
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

function toFinanceSummary(rows: FinanceListItem[]): FinanceSummary {
  const summary: FinanceSummary = {
    totalDocuments: rows.length,
    totalAmountCents: 0,
    invoiceDocuments: 0,
    receiptDocuments: 0,
    paidAmountCents: 0,
    pendingAmountCents: 0,
    refundedAmountCents: 0,
  }

  for (const row of rows) {
    summary.totalAmountCents += row.amountCents
    if (row.sourceType === 'INVOICE') summary.invoiceDocuments += 1
    if (row.sourceType === 'RECEIPT') summary.receiptDocuments += 1
    if (row.paymentState === 'PAID') summary.paidAmountCents += row.amountCents
    if (row.paymentState === 'PENDING') summary.pendingAmountCents += row.amountCents
    if (row.paymentState === 'REFUNDED') summary.refundedAmountCents += row.amountCents
  }

  return summary
}

function mapInvoicePaymentState(params: {
  invoiceStatus: InvoiceStatus
  paymentStatus: PaymentStatus | null
}) {
  if (params.invoiceStatus === InvoiceStatus.REFUNDED) return 'REFUNDED'
  if (params.invoiceStatus === InvoiceStatus.VOID) return 'VOID'
  if (params.paymentStatus === PaymentStatus.PENDING) return 'PENDING'
  if (params.paymentStatus === PaymentStatus.REFUNDED) return 'REFUNDED'
  return 'PAID'
}

export async function getClubFinanceRecords(params: {
  clubId: string
  filters?: FinanceListFilters
}) {
  const page = Math.max(1, Number(params.filters?.page || 1))
  const pageSize = Math.min(200, Math.max(1, Number(params.filters?.pageSize || 50)))
  const source = params.filters?.source || 'ALL'
  const requestedStatus = params.filters?.status?.trim() || null
  const dateFrom = params.filters?.dateFrom || null
  const dateTo = params.filters?.dateTo || null

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    clubId: params.clubId,
  }
  if (dateFrom || dateTo) {
    invoiceWhere.issueDate = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    }
  }
  if ((requestedStatus || '').toUpperCase() === 'ISSUED') {
    invoiceWhere.status = InvoiceStatus.ISSUED
  } else if ((requestedStatus || '').toUpperCase() === 'VOID') {
    invoiceWhere.status = InvoiceStatus.VOID
  } else if ((requestedStatus || '').toUpperCase() === 'REFUNDED') {
    invoiceWhere.status = InvoiceStatus.REFUNDED
  }

  const paymentWhere: Prisma.PaymentWhereInput = {
    clubId: params.clubId,
    orderId: null,
  }
  if (dateFrom || dateTo) {
    paymentWhere.createdAt = {
      ...(dateFrom ? { gte: dateFrom } : {}),
      ...(dateTo ? { lte: dateTo } : {}),
    }
  }
  if ((requestedStatus || '').toUpperCase() === 'PAID') {
    paymentWhere.status = PaymentStatus.PAID
  } else if ((requestedStatus || '').toUpperCase() === 'PENDING') {
    paymentWhere.status = PaymentStatus.PENDING
  } else if ((requestedStatus || '').toUpperCase() === 'REFUNDED') {
    paymentWhere.status = PaymentStatus.REFUNDED
  }

  const [invoiceRows, paymentRows] = await Promise.all([
    source === 'RECEIPT'
      ? Promise.resolve([])
      : prisma.invoice.findMany({
          where: invoiceWhere,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
            order: {
              select: {
                id: true,
                orderNumber: true,
                payments: {
                  select: {
                    status: true,
                    method: true,
                    providerRef: true,
                    createdAt: true,
                  },
                  orderBy: [{ createdAt: 'desc' }],
                },
                bookings: {
                  include: {
                    room: {
                      select: {
                        id: true,
                        name: true,
                      },
                    },
                  },
                  orderBy: [{ checkIn: 'asc' }],
                  take: 1,
                },
              },
            },
          },
          orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
          take: 1000,
        }),
    source === 'INVOICE'
      ? Promise.resolve([])
      : prisma.payment.findMany({
          where: paymentWhere,
          include: {
            markedByUser: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            booking: {
              select: {
                id: true,
                status: true,
                paymentStatus: true,
                checkIn: true,
                checkOut: true,
                guestName: true,
                guestEmail: true,
                guestPhone: true,
                priceCurrency: true,
                room: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                club: {
                  select: {
                    currency: true,
                  },
                },
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }],
          take: 1000,
        }),
  ])

  const invoiceRecords: FinanceListItem[] = invoiceRows.map((invoice) => {
    const booking = invoice.order.bookings[0] || null
    const latestPayment = invoice.order.payments[0] || null
    const paymentState = mapInvoicePaymentState({
      invoiceStatus: invoice.status,
      paymentStatus: latestPayment?.status || null,
    })
    return {
      recordId: toRecordId('INVOICE', invoice.id),
      sourceType: 'INVOICE',
      invoiceId: invoice.id,
      paymentId: null,
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.order.orderNumber,
      documentStatus: invoice.status,
      paymentState,
      issuedAt: invoice.issueDate.toISOString(),
      amountCents: invoice.totalCents,
      currency: toCurrency(invoice.currency),
      method:
        latestPayment?.method ||
        (booking?.paymentStatus === PaymentStatus.PAID ? 'OFFLINE_PAY_AT_VENUE' : 'ONLINE_PROVIDER'),
      providerRef: latestPayment?.providerRef || null,
      bookingId: booking?.id || null,
      guestName: booking?.guestName || invoice.user.name || null,
      guestEmail: booking?.guestEmail || invoice.user.email || null,
      roomName: booking?.room?.name || null,
      clubId: params.clubId,
    }
  })

  const receiptRecords: FinanceListItem[] = paymentRows.map((payment) => {
    const paymentState = payment.status
    return {
      recordId: toRecordId('RECEIPT', payment.id),
      sourceType: 'RECEIPT',
      invoiceId: null,
      paymentId: payment.id,
      invoiceNumber: `RCP-${payment.id}`,
      orderNumber: null,
      documentStatus: payment.status,
      paymentState,
      issuedAt: payment.createdAt.toISOString(),
      amountCents: payment.amountCents,
      currency: toCurrency(payment.booking?.priceCurrency || payment.booking?.club?.currency),
      method: payment.method,
      providerRef: payment.providerRef,
      bookingId: payment.booking?.id || null,
      guestName: payment.booking?.guestName || null,
      guestEmail: payment.booking?.guestEmail || null,
      roomName: payment.booking?.room?.name || null,
      clubId: params.clubId,
    }
  })

  const merged = [...invoiceRecords, ...receiptRecords]
    .filter((record) => queryMatches(record, params.filters?.query || null))
    .filter((record) =>
      statusMatches({
        requestedStatus,
        documentStatus: record.documentStatus,
        paymentState: record.paymentState,
      }),
    )
    .map((record) => {
      const normalized = normalizeFinanceStatuses({
        documentStatus: record.documentStatus,
        paymentState: record.paymentState,
      })
      return {
        ...record,
        documentStatus: normalized.documentStatus,
        paymentState: normalized.paymentState,
      }
    })
    .sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))

  const total = merged.length
  const skip = (page - 1) * pageSize
  const items = merged.slice(skip, skip + pageSize)
  const summary = toFinanceSummary(merged)

  return {
    items,
    page,
    pageSize,
    total,
    summary,
  }
}

function lineItemsFromSnapshot(snapshot: string | null | undefined): FinanceDetailItem[] {
  const parsed = parsePriceSnapshot(snapshot)
  if (!parsed) return []
  if (Array.isArray(parsed.lineItems) && parsed.lineItems.length > 0) {
    return parsed.lineItems.map((line) => {
      const unitAmountCents =
        typeof line.amountCents === 'number'
          ? Math.trunc(line.amountCents)
          : typeof line.amount === 'number'
            ? Math.trunc(line.amount)
            : 0
      return {
        title: line.title || line.type || 'Line item',
        quantity: 1,
        unitAmountCents,
        totalAmountCents: unitAmountCents,
        type: line.type || 'SNAPSHOT_ITEM',
      }
    })
  }

  if (Array.isArray(parsed.breakdown) && parsed.breakdown.length > 0) {
    return parsed.breakdown.map((line) => {
      const amount = typeof line.amount === 'number' ? Math.trunc(line.amount) : 0
      return {
        title: line.label || line.type || 'Line item',
        quantity: 1,
        unitAmountCents: amount,
        totalAmountCents: amount,
        type: line.type || 'SNAPSHOT_ITEM',
      }
    })
  }

  return []
}

export async function getClubFinanceRecordDetail(params: {
  clubId: string
  recordId: string
}) {
  const parsed = parseFinanceRecordId(params.recordId)
  if (!parsed) return null

  if (parsed.sourceType === 'INVOICE' && parsed.invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: parsed.invoiceId,
        clubId: params.clubId,
      },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }],
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            payments: {
              select: {
                status: true,
                method: true,
                providerRef: true,
                createdAt: true,
              },
              orderBy: [{ createdAt: 'desc' }],
            },
            bookings: {
              include: {
                room: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                club: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    city: true,
                  },
                },
              },
              orderBy: [{ checkIn: 'asc' }],
              take: 1,
            },
          },
        },
      },
    })
    if (!invoice) return null

    const booking = invoice.order.bookings[0] || null
    const latestPayment = invoice.order.payments[0] || null
    const paymentState = mapInvoicePaymentState({
      invoiceStatus: invoice.status,
      paymentStatus: latestPayment?.status || null,
    })

    return {
      recordId: toRecordId('INVOICE', invoice.id),
      sourceType: 'INVOICE',
      invoiceId: invoice.id,
      paymentId: null,
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.order.orderNumber,
      issueDate: invoice.issueDate.toISOString(),
      documentStatus: invoice.status,
      paymentState,
      amountCents: invoice.totalCents,
      currency: toCurrency(invoice.currency),
      subtotalCents: invoice.subtotalCents,
      discountTotalCents: invoice.discountTotalCents,
      taxTotalCents: invoice.taxTotalCents,
      totalCents: invoice.totalCents,
      method:
        latestPayment?.method ||
        (booking?.paymentStatus === PaymentStatus.PAID ? 'OFFLINE_PAY_AT_VENUE' : 'ONLINE_PROVIDER'),
      providerRef: latestPayment?.providerRef || null,
      customer: {
        name: booking?.guestName || invoice.user.name || null,
        email: booking?.guestEmail || invoice.user.email || null,
        phone: booking?.guestPhone || invoice.user.phone || null,
      },
      booking: booking
        ? {
            id: booking.id,
            status: booking.status,
            paymentStatus: booking.paymentStatus,
            checkIn: booking.checkIn.toISOString(),
            checkOut: booking.checkOut.toISOString(),
            seatLabel: booking.seatLabelSnapshot,
            roomName: booking.room?.name || null,
            clubName: booking.club?.name || null,
            clubAddress: booking.club?.address || null,
            clubCity: booking.club?.city || null,
          }
        : null,
      lineItems:
        invoice.items.length > 0
          ? invoice.items.map((item) => ({
              title: item.description,
              quantity: item.quantity,
              unitAmountCents: item.unitAmountCents,
              totalAmountCents: item.totalAmountCents,
              type: 'INVOICE_ITEM',
            }))
          : [
              {
                title: 'Booking payment',
                quantity: 1,
                unitAmountCents: invoice.totalCents,
                totalAmountCents: invoice.totalCents,
                type: 'INVOICE_ITEM',
              },
            ],
    } satisfies FinanceDetail
  }

  if (parsed.sourceType === 'RECEIPT' && parsed.paymentId) {
    const payment = await prisma.payment.findFirst({
      where: {
        id: parsed.paymentId,
        clubId: params.clubId,
      },
      include: {
        booking: {
          include: {
            room: {
              select: {
                id: true,
                name: true,
              },
            },
            club: {
              select: {
                id: true,
                name: true,
                address: true,
                city: true,
              },
            },
          },
        },
      },
    })
    if (!payment) return null

    const lineItems = lineItemsFromSnapshot(payment.booking.priceSnapshotJson)
    const fallbackLineItem: FinanceDetailItem = {
      title: 'Booking payment',
      quantity: 1,
      unitAmountCents: payment.amountCents,
      totalAmountCents: payment.amountCents,
      type: 'PAYMENT',
    }
    const normalizedLineItems = lineItems.length > 0 ? lineItems : [fallbackLineItem]

    return {
      recordId: toRecordId('RECEIPT', payment.id),
      sourceType: 'RECEIPT',
      invoiceId: null,
      paymentId: payment.id,
      invoiceNumber: `RCP-${payment.id}`,
      orderNumber: null,
      issueDate: payment.createdAt.toISOString(),
      documentStatus: payment.status,
      paymentState: payment.status,
      amountCents: payment.amountCents,
      currency: toCurrency(payment.booking.priceCurrency),
      subtotalCents: payment.amountCents,
      discountTotalCents: 0,
      taxTotalCents: 0,
      totalCents: payment.amountCents,
      method: payment.method,
      providerRef: payment.providerRef,
      customer: {
        name: payment.booking.guestName,
        email: payment.booking.guestEmail,
        phone: payment.booking.guestPhone,
      },
      booking: {
        id: payment.booking.id,
        status: payment.booking.status,
        paymentStatus: payment.booking.paymentStatus,
        checkIn: payment.booking.checkIn.toISOString(),
        checkOut: payment.booking.checkOut.toISOString(),
        seatLabel: payment.booking.seatLabelSnapshot,
        roomName: payment.booking.room?.name || null,
        clubName: payment.booking.club?.name || null,
        clubAddress: payment.booking.club?.address || null,
        clubCity: payment.booking.club?.city || null,
      },
      lineItems: normalizedLineItems,
    } satisfies FinanceDetail
  }

  return null
}

export function financeRecordsToCsv(records: FinanceListItem[]) {
  const header = [
    'recordId',
    'sourceType',
    'invoiceNumber',
    'orderNumber',
    'documentStatus',
    'paymentState',
    'issuedAt',
    'amountCents',
    'currency',
    'method',
    'providerRef',
    'bookingId',
    'guestName',
    'guestEmail',
    'roomName',
  ]

  const escape = (value: string | number | null | undefined) => {
    const raw = value == null ? '' : String(value)
    if (!/[",\n]/.test(raw)) return raw
    return `"${raw.replaceAll('"', '""')}"`
  }

  const rows = records.map((record) =>
    [
      record.recordId,
      record.sourceType,
      record.invoiceNumber,
      record.orderNumber,
      record.documentStatus,
      record.paymentState,
      record.issuedAt,
      record.amountCents,
      record.currency,
      record.method,
      record.providerRef,
      record.bookingId,
      record.guestName,
      record.guestEmail,
      record.roomName,
    ]
      .map((value) => escape(value))
      .join(','),
  )

  return [header.join(','), ...rows].join('\n')
}
