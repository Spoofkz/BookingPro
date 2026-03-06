import { NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ id: string }>
}

function parsePriceSnapshot(snapshot: string | null) {
  if (!snapshot) return null
  try {
    const parsed = JSON.parse(snapshot) as {
      lineItems?: Array<{ title?: string; amountCents?: number; amount?: number; type?: string }>
      breakdown?: Array<{ label?: string; amount?: number; type?: string }>
      totalCents?: number
      total?: number
      currency?: string
    }
    if (!parsed.lineItems && Array.isArray(parsed.breakdown)) {
      parsed.lineItems = parsed.breakdown.map((item) => ({
        title: item.label || item.type || 'Line item',
        amountCents: typeof item.amount === 'number' ? Math.trunc(item.amount) : 0,
        type: item.type,
      }))
    }
    return parsed
  } catch {
    return null
  }
}

export async function GET(_: Request, routeContext: RouteContext) {
  const { id } = await routeContext.params
  const invoiceId = id.trim()
  if (!invoiceId) return NextResponse.json({ error: 'Invalid invoice id.' }, { status: 400 })

  try {
    const context = await getCabinetContext({ requireSession: true })
    const invoice = await prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        userId: context.userId,
      },
      include: {
        items: true,
        order: {
          include: {
            items: true,
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
                    slug: true,
                    city: true,
                    address: true,
                    currency: true,
                    timezone: true,
                  },
                },
              },
              orderBy: [{ checkIn: 'asc' }],
            },
          },
        },
      },
    })

    if (invoice) {
      const booking = invoice.order.bookings[0]
      const breakdownSource = invoice.order.items[0]?.priceSnapshotJson || invoice.order.pricingSnapshotJson
      const parsedBreakdown = parsePriceSnapshot(breakdownSource || null)

      await prisma.auditLog.create({
        data: {
          clubId: invoice.clubId,
          actorUserId: context.userId,
          action: 'client.invoice.viewed',
          entityType: 'invoice',
          entityId: invoice.id,
          ...(booking ? { bookingId: booking.id } : {}),
        },
      })

      return NextResponse.json({
        invoiceId: invoice.id,
        receiptNumber: invoice.invoiceNumber,
        issuedAt: invoice.issueDate,
        status: invoice.status,
        method: booking?.channel === 'OFFLINE' ? 'OFFLINE_PAY_AT_VENUE' : 'ONLINE_PROVIDER',
        providerRef: null,
        amountCents: invoice.totalCents,
        currency: invoice.currency,
        booking: booking
          ? {
              id: booking.id,
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              checkIn: booking.checkIn,
              checkOut: booking.checkOut,
              guestName: booking.guestName,
              guestEmail: booking.guestEmail,
              guestPhone: booking.guestPhone,
              room: booking.room,
              club: booking.club,
            }
          : null,
        breakdown: {
          lineItems:
            parsedBreakdown?.lineItems ||
            invoice.items.map((item) => ({
              title: item.description,
              amountCents: item.totalAmountCents,
              type: 'INVOICE_ITEM',
            })),
          totalCents: invoice.totalCents,
        },
        printableUrl: `/api/client/invoices/${invoice.id}/pdf`,
      })
    }

    const parsedLegacyInvoiceId = Number(invoiceId)
    if (!Number.isInteger(parsedLegacyInvoiceId) || parsedLegacyInvoiceId < 1) {
      return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: parsedLegacyInvoiceId,
        booking: {
          OR: [
            { clientUserId: context.userId },
            ...(context.profile.email ? [{ guestEmail: context.profile.email.toLowerCase() }] : []),
          ],
        },
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
                slug: true,
                city: true,
                address: true,
                currency: true,
                timezone: true,
              },
            },
          },
        },
      },
    })
    if (!payment) {
      return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
    }

    await prisma.auditLog.create({
      data: {
        clubId: payment.booking.club?.id || payment.booking.clubId,
        actorUserId: context.userId,
        action: 'client.invoice.viewed',
        entityType: 'invoice',
        entityId: invoiceId,
        bookingId: payment.booking.id,
      },
    })

    const priceSnapshot = parsePriceSnapshot(payment.booking.priceSnapshotJson)
    const lineItems = priceSnapshot?.lineItems || []
    const snapshotTotal =
      typeof priceSnapshot?.totalCents === 'number'
        ? priceSnapshot.totalCents
        : typeof priceSnapshot?.total === 'number'
          ? Math.round(priceSnapshot.total)
          : null
    const currency =
      payment.booking.priceCurrency ||
      priceSnapshot?.currency ||
      payment.booking.club?.currency ||
      'KZT'

    return NextResponse.json({
      invoiceId: invoiceId,
      receiptNumber: `RCP-${payment.id}`,
      issuedAt: payment.createdAt,
      status: payment.status,
      method: payment.method,
      providerRef: payment.providerRef,
      amountCents: payment.amountCents,
      currency,
      booking: {
        id: payment.booking.id,
        status: payment.booking.status,
        paymentStatus: payment.booking.paymentStatus,
        checkIn: payment.booking.checkIn,
        checkOut: payment.booking.checkOut,
        guestName: payment.booking.guestName,
        guestEmail: payment.booking.guestEmail,
        guestPhone: payment.booking.guestPhone,
        room: payment.booking.room,
        club: payment.booking.club,
      },
      breakdown: {
        lineItems,
        totalCents: snapshotTotal,
      },
      printableUrl: `/api/client/invoices/${payment.id}/pdf`,
    })
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
}
