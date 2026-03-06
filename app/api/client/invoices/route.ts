import { PaymentStatus } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

function toInvoiceCurrency(currency: string | null | undefined) {
  const value = (currency || '').trim().toUpperCase()
  return value || 'KZT'
}

export async function GET(request: NextRequest) {
  try {
    const context = await getCabinetContext({ requireSession: true })
    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || '20')))
    const skip = (page - 1) * pageSize

    const requestedStatus = searchParams.get('status')?.trim().toUpperCase()
    const legacyPaymentStatus =
      requestedStatus === PaymentStatus.PAID ||
      requestedStatus === PaymentStatus.PENDING ||
      requestedStatus === PaymentStatus.REFUNDED
        ? requestedStatus
        : null

    const [invoiceRows, legacyPaymentRows] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          userId: context.userId,
        },
        include: {
          order: {
            include: {
              bookings: {
                include: {
                  room: {
                    select: { id: true, name: true },
                  },
                  club: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      city: true,
                      address: true,
                      currency: true,
                    },
                  },
                },
                orderBy: [{ checkIn: 'asc' }],
              },
            },
          },
        },
        orderBy: [{ issueDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.payment.findMany({
        where: {
          ...(legacyPaymentStatus ? { status: legacyPaymentStatus } : {}),
          booking: {
            OR: [
              { clientUserId: context.userId },
              ...(context.profile.email ? [{ guestEmail: context.profile.email.toLowerCase() }] : []),
            ],
          },
          orderId: null,
        },
        include: {
          booking: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              checkIn: true,
              checkOut: true,
              guestName: true,
              guestEmail: true,
              priceCurrency: true,
              room: {
                select: { id: true, name: true },
              },
              club: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  city: true,
                  address: true,
                  currency: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: pageSize,
      }),
    ])

    const items = [
      ...invoiceRows.map((row) => {
        const booking = row.order.bookings[0] || null
        return {
          invoiceId: row.id,
          paymentId: null,
          status: row.status,
          amountCents: row.totalCents,
          currency: toInvoiceCurrency(row.currency),
          issuedAt: row.issueDate,
          receiptType: 'INVOICE',
          method: booking?.channel === 'OFFLINE' ? 'OFFLINE_PAY_AT_VENUE' : 'ONLINE_PROVIDER',
          providerRef: null,
          booking: booking
            ? {
                id: booking.id,
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                checkIn: booking.checkIn,
                checkOut: booking.checkOut,
                guestName: booking.guestName,
                guestEmail: booking.guestEmail,
                room: booking.room,
                club: booking.club,
              }
            : null,
          downloadPdfUrl: `/api/client/invoices/${row.id}/pdf`,
        }
      }),
      ...legacyPaymentRows.map((item) => ({
        invoiceId: String(item.id),
        paymentId: item.id,
        status: item.status,
        amountCents: item.amountCents,
        currency: toInvoiceCurrency(item.booking.priceCurrency || item.booking.club?.currency),
        issuedAt: item.createdAt,
        receiptType:
          item.method.toUpperCase().includes('OFFLINE') ||
          item.method.toUpperCase().includes('CASH') ||
          item.method.toUpperCase().includes('POS')
            ? 'OFFLINE_RECEIPT'
            : 'INVOICE',
        method: item.method,
        providerRef: item.providerRef,
        booking: {
          id: item.booking.id,
          status: item.booking.status,
          paymentStatus: item.booking.paymentStatus,
          checkIn: item.booking.checkIn,
          checkOut: item.booking.checkOut,
          guestName: item.booking.guestName,
          guestEmail: item.booking.guestEmail,
          room: item.booking.room,
          club: item.booking.club,
        },
        downloadPdfUrl: `/api/client/invoices/${item.id}/pdf`,
      })),
    ].sort((a, b) => +new Date(b.issuedAt) - +new Date(a.issuedAt))

    const total = items.length

    return NextResponse.json({
      items,
      page,
      pageSize,
      total,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
