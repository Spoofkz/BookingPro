import crypto from 'crypto'
import {
  BookingStatus,
  ChannelType,
  CustomerType,
  HoldPurpose,
  HoldStatus,
  OrderSource,
  OrderStatus,
  PaymentIntentStatus,
  PaymentStatus,
  Prisma,
  SlotStatus,
} from '@prisma/client'
import { activeBookingStatuses } from '@/src/lib/bookingLifecycle'
import { generatePriceQuote } from '@/src/lib/pricingEngine'
import { prisma } from '@/src/lib/prisma'
import { resolveOrCreateCustomerForBooking } from '@/src/lib/customerManagement'
import { resolveOrCreateOperationalRoom } from '@/src/lib/operationalRoom'

const DEFAULT_ORDER_TTL_MINUTES = 10

export class CommerceError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(
    code: string,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

type OrderGuestInput = {
  guestName?: string | null
  guestEmail?: string | null
  guestPhone?: string | null
  guests?: number | null
  notes?: string | null
}

type CreateSeatOrderInput = OrderGuestInput & {
  userId: string
  clubId: string
  holdId?: string
  holdIds?: string[]
  roomId?: number | null
  packageId?: string | null
  promoCode?: string | null
  paymentMode?: 'OFFLINE' | 'ONLINE'
  source?: OrderSource
}

function fallbackGuestEmail(userId: string) {
  return `client+${userId}@local.invalid`
}

function buildOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `ORD-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

function toInvoiceClubCode(input: string) {
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalized) return 'CLUB'
  return normalized.slice(0, 8)
}

function getInvoiceMonthWindow(issueDate: Date) {
  const year = issueDate.getUTCFullYear()
  const month = issueDate.getUTCMonth()
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0))
  const yearMonth = `${year}${String(month + 1).padStart(2, '0')}`
  return { start, end, yearMonth }
}

async function createUniqueOrderNumber(tx: Prisma.TransactionClient) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = buildOrderNumber()
    const exists = await tx.order.findUnique({
      where: { orderNumber: candidate },
      select: { id: true },
    })
    if (!exists) return candidate
  }
  throw new CommerceError('ORDER_NUMBER_GENERATION_FAILED', 500, 'Failed to allocate order number.')
}

async function createUniqueInvoiceNumber(
  tx: Prisma.TransactionClient,
  params: { clubId: string; issueDate: Date },
) {
  const club = await tx.club.findUnique({
    where: { id: params.clubId },
    select: { id: true, slug: true, name: true },
  })
  if (!club) {
    throw new CommerceError('CLUB_NOT_FOUND', 404, 'Club not found for invoice numbering.')
  }

  const { start, end, yearMonth } = getInvoiceMonthWindow(params.issueDate)
  const clubCode = toInvoiceClubCode(club.slug || club.name || club.id)
  const prefix = `INV-${clubCode}-${yearMonth}-`

  const monthlyInvoices = await tx.invoice.findMany({
    where: {
      clubId: params.clubId,
      issueDate: { gte: start, lt: end },
    },
    select: { invoiceNumber: true },
  })

  let maxSequence = 0
  for (const row of monthlyInvoices) {
    if (!row.invoiceNumber.startsWith(prefix)) continue
    const raw = row.invoiceNumber.slice(prefix.length)
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 1) continue
    if (parsed > maxSequence) maxSequence = parsed
  }

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const sequence = maxSequence + attempt
    const candidate = `${prefix}${String(sequence).padStart(5, '0')}`
    const exists = await tx.invoice.findUnique({
      where: { invoiceNumber: candidate },
      select: { id: true },
    })
    if (!exists) return candidate
  }
  throw new CommerceError('INVOICE_NUMBER_GENERATION_FAILED', 500, 'Failed to allocate invoice number.')
}

function parseDiscountFromBreakdown(
  breakdown: Array<{ type?: string; amount?: number }> | undefined,
) {
  if (!breakdown || breakdown.length === 0) return 0
  let discount = 0
  for (const item of breakdown) {
    const amount = Number(item.amount ?? 0)
    if (Number.isNaN(amount)) continue
    if (amount >= 0) continue
    if (item.type === 'PROMO' || item.type === 'PACKAGE_DISCOUNT') {
      discount += Math.abs(Math.trunc(amount))
    }
  }
  return discount
}

async function resolveSeatSnapshot(params: {
  tx: Prisma.TransactionClient
  clubId: string
  seatId: string
}) {
  const latestMapVersion = await params.tx.seatMapVersion.findFirst({
    where: { clubId: params.clubId },
    orderBy: [{ versionNumber: 'desc' }, { publishedAt: 'desc' }],
    select: { id: true },
  })
  if (!latestMapVersion) {
    throw new CommerceError('MAP_NOT_PUBLISHED', 409, 'No published seat map version found.')
  }
  const seat = await params.tx.seatIndex.findFirst({
    where: {
      clubId: params.clubId,
      mapVersionId: latestMapVersion.id,
      seatId: params.seatId,
      isActive: true,
    },
    select: {
      seatId: true,
      label: true,
      segmentId: true,
      isDisabled: true,
      disabledReason: true,
    },
  })
  if (!seat) {
    throw new CommerceError('SEAT_NOT_FOUND', 404, 'Seat not found on published map.')
  }
  if (seat.isDisabled) {
    throw new CommerceError(
      'SEAT_DISABLED',
      409,
      seat.disabledReason
        ? `Seat is disabled: ${seat.disabledReason}`
        : 'Seat is disabled.',
    )
  }
  return seat
}

export async function createClientSeatOrder(input: CreateSeatOrderInput) {
  const now = new Date()
  const uniqueHoldIds = Array.from(
    new Set(
      [input.holdId || '', ...(input.holdIds || [])]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  )
  if (uniqueHoldIds.length < 1) {
    throw new CommerceError('HOLD_NOT_FOUND', 404, 'No holds were provided.')
  }

  const holds = await prisma.hold.findMany({
    where: {
      id: { in: uniqueHoldIds },
      clubId: input.clubId,
      ownerUserId: input.userId,
      purpose: HoldPurpose.BOOKING,
    },
    include: {
      slot: {
        select: {
          id: true,
          startAtUtc: true,
          endAtUtc: true,
          status: true,
        },
      },
    },
  })

  if (holds.length !== uniqueHoldIds.length) {
    throw new CommerceError('HOLD_NOT_FOUND', 404, 'One or more holds were not found.')
  }
  for (const hold of holds) {
    if (hold.status !== HoldStatus.ACTIVE || hold.expiresAtUtc <= now) {
      throw new CommerceError('HOLD_EXPIRED', 409, 'Hold expired. Please reselect seat(s).')
    }
    if (hold.slot.status !== SlotStatus.PUBLISHED) {
      throw new CommerceError('SLOT_NOT_AVAILABLE', 409, 'Selected slot is not bookable.')
    }
  }

  const existingItems = await prisma.orderItem.findMany({
    where: {
      holdId: { in: uniqueHoldIds },
      order: {
        status: {
          in: [
            OrderStatus.DRAFT,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.AWAITING_OFFLINE_PAYMENT,
            OrderStatus.PAID,
            OrderStatus.COMPLETED,
          ],
        },
      },
    },
    include: {
      order: {
        include: {
          items: true,
        },
      },
    },
  })
  if (existingItems.length > 0) {
    const uniqueOrderIds = Array.from(new Set(existingItems.map((item) => item.order.id)))
    const allAttached = existingItems.length === uniqueHoldIds.length
    if (uniqueOrderIds.length === 1 && allAttached) {
      return existingItems[0].order
    }
    throw new CommerceError(
      'HOLD_ALREADY_ATTACHED',
      409,
      'One or more holds are already attached to another active order.',
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const room = await resolveOrCreateOperationalRoom({
      tx,
      clubId: input.clubId,
      preferredRoomId: input.roomId ?? null,
      seatSegmentId: null,
    })

    const holdById = new Map(holds.map((hold) => [hold.id, hold]))
    const orderedHolds = uniqueHoldIds
      .map((holdId) => holdById.get(holdId))
      .filter((hold): hold is (typeof holds)[number] => Boolean(hold))
    if (orderedHolds.length !== uniqueHoldIds.length) {
      throw new CommerceError('HOLD_NOT_FOUND', 404, 'One or more holds are missing.')
    }

    const preparedItems: Array<{
      holdId: string
      slotId: string
      seatId: string
      seatLabel: string
      segmentId: string | null
      startAtUtc: Date
      endAtUtc: Date
      holdExpiresAt: Date
      unitPriceCents: number
      totalPriceCents: number
      discountCents: number
      quote: Awaited<ReturnType<typeof generatePriceQuote>>
    }> = []

    for (const hold of orderedHolds) {
      const seat = await resolveSeatSnapshot({
        tx,
        clubId: input.clubId,
        seatId: hold.seatId,
      })
      const quote = await generatePriceQuote({
        clubId: input.clubId,
        roomId: room.id,
        segmentId: seat.segmentId,
        startAt: hold.slot.startAtUtc,
        endAt: hold.slot.endAtUtc,
        packageId: input.packageId || undefined,
        promoCode: input.promoCode || undefined,
        channel:
          input.paymentMode === 'OFFLINE' ? ChannelType.OFFLINE : ChannelType.ONLINE,
        customerType: CustomerType.GUEST,
        persistQuote: true,
      })
      const discount = parseDiscountFromBreakdown(
        quote.breakdown as Array<{ type?: string; amount?: number }>,
      )
      preparedItems.push({
        holdId: hold.id,
        slotId: hold.slotId,
        seatId: hold.seatId,
        seatLabel: seat.label,
        segmentId: seat.segmentId,
        startAtUtc: hold.slot.startAtUtc,
        endAtUtc: hold.slot.endAtUtc,
        holdExpiresAt: hold.expiresAtUtc,
        unitPriceCents: quote.total,
        totalPriceCents: quote.total,
        discountCents: discount,
        quote,
      })
    }

    const subtotal = preparedItems.reduce(
      (sum, item) => sum + Math.max(0, Math.trunc(item.totalPriceCents + item.discountCents)),
      0,
    )
    const total = preparedItems.reduce((sum, item) => sum + item.totalPriceCents, 0)
    const totalDiscount = preparedItems.reduce((sum, item) => sum + item.discountCents, 0)
    const expiresAt = new Date(
      Math.min(
        ...preparedItems.map((item) =>
          Math.min(
            item.holdExpiresAt.getTime(),
            now.getTime() + DEFAULT_ORDER_TTL_MINUTES * 60_000,
          ),
        ),
      ),
    )

    const order = await tx.order.create({
      data: {
        orderNumber: await createUniqueOrderNumber(tx),
        userId: input.userId,
        clubId: input.clubId,
        status:
          input.paymentMode === 'ONLINE'
            ? OrderStatus.PENDING_PAYMENT
            : OrderStatus.AWAITING_OFFLINE_PAYMENT,
        source: input.source ?? OrderSource.CLIENT,
        currency: preparedItems[0]?.quote.currency || 'KZT',
        subtotalCents: subtotal,
        discountTotalCents: totalDiscount,
        totalCents: total,
        pricingSnapshotJson: JSON.stringify({
          items: preparedItems.map((item) => ({
            holdId: item.holdId,
            slotId: item.slotId,
            seatId: item.seatId,
            seatLabel: item.seatLabel,
            quoteId: item.quote.quoteId,
            pricingVersionId: item.quote.pricingVersionId,
            breakdown: item.quote.breakdown,
            promotion: item.quote.promotion || null,
            package: item.quote.package || null,
            totalCents: item.totalPriceCents,
          })),
        }),
        expiresAt,
      },
    })

    for (const item of preparedItems) {
      await tx.orderItem.create({
        data: {
          orderId: order.id,
          holdId: item.holdId,
          slotId: item.slotId,
          seatId: item.seatId,
          seatLabelSnapshot: item.seatLabel,
          roomId: room.id,
          segmentId: item.segmentId,
          startAtUtc: item.startAtUtc,
          endAtUtc: item.endAtUtc,
          quantity: 1,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
          priceSnapshotJson: JSON.stringify({
            quoteId: item.quote.quoteId,
            breakdown: item.quote.breakdown,
            pricingVersionId: item.quote.pricingVersionId,
            packageId: input.packageId || null,
            promoCode: input.promoCode || null,
          }),
        },
      })
    }

    await tx.hold.updateMany({
      where: { id: { in: preparedItems.map((item) => item.holdId) } },
      data: { orderId: order.id },
    })

    await tx.auditLog.create({
      data: {
        clubId: input.clubId,
        actorUserId: input.userId,
        action: 'order.created',
        entityType: 'order',
        entityId: order.id,
        metadata: JSON.stringify({
          orderNumber: order.orderNumber,
          holdIds: preparedItems.map((item) => item.holdId),
          itemCount: preparedItems.length,
          paymentMode: input.paymentMode ?? 'OFFLINE',
        }),
      },
    })

    return tx.order.findUnique({
      where: { id: order.id },
      include: {
        items: true,
      },
    })
  })

  if (!result) {
    throw new CommerceError('ORDER_CREATE_FAILED', 500, 'Failed to create order.')
  }
  return result
}

export async function getOwnedOrder(params: { orderId: string; userId: string }) {
  return prisma.order.findFirst({
    where: { id: params.orderId, userId: params.userId },
    include: {
      items: true,
      paymentIntents: {
        orderBy: [{ createdAt: 'desc' }],
      },
      invoices: {
        orderBy: [{ issueDate: 'desc' }],
      },
      bookings: {
        include: {
          room: {
            select: { id: true, name: true, slug: true },
          },
          club: {
            select: { id: true, name: true, slug: true, address: true, city: true },
          },
        },
        orderBy: [{ checkIn: 'asc' }],
      },
      club: {
        select: { id: true, name: true, slug: true, currency: true, timezone: true },
      },
    },
  })
}

async function issueInvoiceForOrderTx(params: {
  tx: Prisma.TransactionClient
  orderId: string
  actorUserId: string | null
}) {
  const existing = await params.tx.invoice.findUnique({
    where: { orderId: params.orderId },
    include: { items: true },
  })
  if (existing) return existing

  const order = await params.tx.order.findUnique({
    where: { id: params.orderId },
    include: {
      items: true,
      bookings: {
        orderBy: [{ id: 'asc' }],
      },
    },
  })
  if (!order) {
    throw new CommerceError('ORDER_NOT_FOUND', 404, 'Order not found.')
  }
  const issueDate = new Date()

  const invoice = await params.tx.invoice.create({
    data: {
      invoiceNumber: await createUniqueInvoiceNumber(params.tx, {
        clubId: order.clubId,
        issueDate,
      }),
      userId: order.userId,
      orderId: order.id,
      clubId: order.clubId,
      status: 'ISSUED',
      issueDate,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountTotalCents: order.discountTotalCents,
      taxTotalCents: order.taxTotalCents,
      totalCents: order.totalCents,
      metadataJson: JSON.stringify({
        orderNumber: order.orderNumber,
      }),
      items: {
        create: order.items.map((item, index) => ({
          orderItemId: item.id,
          description:
            item.type === 'SEAT_BOOKING'
              ? `Seat booking ${item.seatLabelSnapshot || item.seatId || index + 1}`
              : 'Commerce item',
          quantity: item.quantity,
          unitAmountCents: item.unitPriceCents,
          totalAmountCents: item.totalPriceCents,
        })),
      },
    },
    include: { items: true },
  })

  if (order.bookings.length) {
    await params.tx.booking.updateMany({
      where: {
        id: { in: order.bookings.map((booking) => booking.id) },
      },
      data: {
        invoiceId: invoice.id,
      },
    })
  }

  await params.tx.auditLog.create({
    data: {
      clubId: order.clubId,
      actorUserId: params.actorUserId,
      action: 'invoice.issued',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: JSON.stringify({
        orderId: order.id,
        invoiceNumber: invoice.invoiceNumber,
      }),
    },
  })

  return invoice
}

type FinalizeOrderInput = OrderGuestInput & {
  orderId: string
  userId: string
  paymentMode: 'OFFLINE' | 'ONLINE'
  providerRef?: string | null
  paymentIntentId?: string | null
  markPaid: boolean
}

export async function finalizeOwnedOrder(input: FinalizeOrderInput) {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, userId: input.userId },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }],
        },
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        bookings: {
          orderBy: [{ id: 'asc' }],
        },
      },
    })
    if (!order) {
      throw new CommerceError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }
    if (order.status === OrderStatus.CANCELED || order.status === OrderStatus.EXPIRED) {
      throw new CommerceError('ORDER_NOT_CONFIRMABLE', 409, 'Order is no longer confirmable.')
    }
    if (order.status === OrderStatus.COMPLETED && order.bookings.length > 0) {
      const invoice = await issueInvoiceForOrderTx({
        tx,
        orderId: order.id,
        actorUserId: input.userId,
      })
      return { order, bookings: order.bookings, invoice }
    }
    if (order.items.length === 0) {
      throw new CommerceError('ORDER_EMPTY', 409, 'Order has no items to confirm.')
    }

    const createdBookings: Array<{ id: number }> = []
    for (const item of order.items) {
      if (!item.holdId) {
        throw new CommerceError(
          'ORDER_ITEM_INVALID',
          409,
          'Order item is not linked to a valid hold.',
        )
      }
      const hold = await tx.hold.findUnique({
        where: { id: item.holdId },
        include: {
          slot: {
            select: {
              id: true,
              startAtUtc: true,
              endAtUtc: true,
              status: true,
            },
          },
        },
      })
      if (!hold || hold.clubId !== order.clubId || hold.ownerUserId !== order.userId) {
        throw new CommerceError('HOLD_NOT_FOUND', 404, 'Hold not found for this order item.')
      }
      if (hold.status !== HoldStatus.ACTIVE || hold.expiresAtUtc <= now) {
        throw new CommerceError('HOLD_EXPIRED', 409, 'Hold expired. Please recreate your order.')
      }
      if (hold.slot.status !== SlotStatus.PUBLISHED || hold.slot.endAtUtc <= now) {
        throw new CommerceError('SLOT_NOT_AVAILABLE', 409, 'Slot is no longer available.')
      }

      const conflictingBooking = await tx.booking.findFirst({
        where: {
          clubId: order.clubId,
          slotId: hold.slotId,
          seatId: hold.seatId,
          status: { in: [...activeBookingStatuses()] },
        },
        select: { id: true },
      })
      if (conflictingBooking) {
        throw new CommerceError('SEAT_NOT_AVAILABLE', 409, 'Seat is already booked.')
      }

      const seat = await resolveSeatSnapshot({
        tx,
        clubId: order.clubId,
        seatId: hold.seatId,
      })
      const room = await resolveOrCreateOperationalRoom({
        tx,
        clubId: order.clubId,
        preferredRoomId: item.roomId,
        seatSegmentId: seat.segmentId,
      })

      const guestName = input.guestName || order.user.name || 'Guest'
      const guestEmail = input.guestEmail || order.user.email || fallbackGuestEmail(order.user.id)
      const guestPhone = input.guestPhone || order.user.phone || null
      const guests = Number.isInteger(input.guests) && (input.guests as number) > 0 ? (input.guests as number) : 1

      const customer = await resolveOrCreateCustomerForBooking(tx, {
        clubId: order.clubId,
        actorUserId: input.userId,
        source: 'hold.confirm',
        displayName: guestName,
        phone: guestPhone,
        email: guestEmail,
        linkedUserId: order.userId,
      })

      const booking = await tx.booking.create({
        data: {
          clubId: order.clubId,
          slotId: hold.slotId,
          seatId: hold.seatId,
          seatLabelSnapshot: item.seatLabelSnapshot || seat.label,
          customerId: customer.customer?.id ?? null,
          roomId: room.id,
          clientUserId: order.userId,
          createdByUserId: input.userId,
          guestName,
          guestEmail,
          guestPhone: customer.normalizedPhone || guestPhone,
          checkIn: item.startAtUtc || hold.slot.startAtUtc,
          checkOut: item.endAtUtc || hold.slot.endAtUtc,
          guests,
          notes: input.notes || null,
          status: BookingStatus.CONFIRMED,
          paymentStatus: input.markPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
          channel: input.paymentMode === 'OFFLINE' ? ChannelType.OFFLINE : ChannelType.ONLINE,
          customerType: CustomerType.GUEST,
          priceTotalCents: item.totalPriceCents,
          priceCurrency: order.currency,
          priceSnapshotJson: item.priceSnapshotJson || order.pricingSnapshotJson,
          orderId: order.id,
          orderItemId: item.id,
        },
        select: { id: true },
      })

      await tx.hold.update({
        where: { id: hold.id },
        data: {
          status: HoldStatus.CONVERTED,
          canceledAtUtc: now,
          canceledByUserId: input.userId,
        },
      })

      await tx.payment.create({
        data: {
          clubId: order.clubId,
          bookingId: booking.id,
          orderId: order.id,
          intentId: input.paymentIntentId || null,
          amountCents: item.totalPriceCents,
          method:
            input.paymentMode === 'OFFLINE'
              ? 'OFFLINE_PAY_AT_VENUE'
              : 'ONLINE_PROVIDER',
          providerRef: input.providerRef || null,
          status: input.markPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
          markedByUserId: input.markPaid ? input.userId : null,
        },
      })

      createdBookings.push(booking)
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: input.markPaid ? OrderStatus.COMPLETED : OrderStatus.AWAITING_OFFLINE_PAYMENT,
        completedAt: input.markPaid ? now : null,
        expiresAt: null,
      },
    })

    const invoice = await issueInvoiceForOrderTx({
      tx,
      orderId: order.id,
      actorUserId: input.userId,
    })

    await tx.auditLog.create({
      data: {
        clubId: order.clubId,
        actorUserId: input.userId,
        action: 'order.completed',
        entityType: 'order',
        entityId: order.id,
        metadata: JSON.stringify({
          paymentMode: input.paymentMode,
          paid: input.markPaid,
          bookings: createdBookings.map((booking) => booking.id),
          invoiceId: invoice.id,
        }),
      },
    })

    return {
      orderId: order.id,
      bookingIds: createdBookings.map((booking) => booking.id),
      invoiceId: invoice.id,
    }
  })
}

export async function cancelOwnedOrder(params: { orderId: string; userId: string }) {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: params.orderId, userId: params.userId },
      include: { items: true },
    })
    if (!order) {
      throw new CommerceError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }
    if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.REFUNDED) {
      throw new CommerceError('ORDER_CANCEL_DENIED', 409, 'Completed orders cannot be canceled.')
    }
    if (order.status === OrderStatus.CANCELED) {
      return order
    }

    const holdIds = order.items
      .map((item) => item.holdId)
      .filter((value): value is string => Boolean(value))

    if (holdIds.length) {
      await tx.hold.updateMany({
        where: {
          id: { in: holdIds },
          status: HoldStatus.ACTIVE,
        },
        data: {
          status: HoldStatus.CANCELED,
          canceledAtUtc: now,
          canceledByUserId: params.userId,
        },
      })
    }

    const canceled = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.CANCELED,
        canceledAt: now,
      },
      include: { items: true },
    })

    await tx.auditLog.create({
      data: {
        clubId: canceled.clubId,
        actorUserId: params.userId,
        action: 'order.canceled',
        entityType: 'order',
        entityId: canceled.id,
      },
    })

    return canceled
  })
}

export async function initOwnedOrderPaymentIntent(params: {
  orderId: string
  userId: string
  provider?: string | null
  expiresInMinutes?: number | null
  mockProviderStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | null
}) {
  const provider = (params.provider || 'MOCK_PROVIDER').trim().toUpperCase()
  const ttlMinutes = Math.max(
    0,
    Math.min(60 * 24, Number.isFinite(params.expiresInMinutes) ? Number(params.expiresInMinutes) : DEFAULT_ORDER_TTL_MINUTES),
  )
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: params.orderId, userId: params.userId },
      include: { paymentIntents: { orderBy: [{ createdAt: 'desc' }], take: 1 } },
    })
    if (!order) {
      throw new CommerceError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }
    if (
      order.status === OrderStatus.CANCELED ||
      order.status === OrderStatus.EXPIRED ||
      order.status === OrderStatus.COMPLETED
    ) {
      throw new CommerceError('ORDER_NOT_PAYABLE', 409, 'Order is not payable.')
    }

    const providerRef = `pi_${crypto.randomBytes(6).toString('hex')}`
    const intent = await tx.paymentIntent.create({
      data: {
        orderId: order.id,
        userId: order.userId,
        clubId: order.clubId,
        provider,
        providerRef,
        status: PaymentIntentStatus.PENDING,
        amountCents: order.totalCents,
        currency: order.currency,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        payloadJson: JSON.stringify({
          checkoutUrl: `/me/payments?intent=${providerRef}`,
          mockProviderStatus: params.mockProviderStatus || 'PENDING',
        }),
      },
    })

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: new Date(
          Math.min(
            order.expiresAt?.getTime() || Number.POSITIVE_INFINITY,
            Date.now() + ttlMinutes * 60_000,
          ),
        ),
      },
    })

    await tx.auditLog.create({
      data: {
        clubId: order.clubId,
        actorUserId: params.userId,
        action: 'payment.initiated',
        entityType: 'payment_intent',
        entityId: intent.id,
        metadata: JSON.stringify({
          orderId: order.id,
          providerRef,
          amountCents: intent.amountCents,
          currency: intent.currency,
        }),
      },
    })
    await tx.auditLog.create({
      data: {
        clubId: order.clubId,
        actorUserId: params.userId,
        action: 'payment.intent.created',
        entityType: 'payment_intent',
        entityId: intent.id,
        metadata: JSON.stringify({
          orderId: order.id,
          providerRef,
        }),
      },
    })

    return intent
  })
}

export async function resolvePaymentIntentForWebhook(params: {
  intentId?: string | null
  providerRef?: string | null
}) {
  return prisma.paymentIntent.findFirst({
    where: params.intentId
      ? { id: params.intentId }
      : params.providerRef
        ? { providerRef: params.providerRef }
        : { id: '' },
    include: {
      order: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  })
}

export async function processPaymentWebhook(params: {
  intentId?: string | null
  providerRef?: string | null
  status: 'PAID' | 'FAILED' | 'CANCELED'
  provider?: string | null
}) {
  const intent = await resolvePaymentIntentForWebhook(params)

  if (!intent) {
    throw new CommerceError('INTENT_NOT_FOUND', 404, 'Payment intent not found.')
  }

  if (params.provider && intent.provider !== params.provider.toUpperCase()) {
    throw new CommerceError('INTENT_PROVIDER_MISMATCH', 409, 'Payment intent provider mismatch.')
  }

  await prisma.auditLog.create({
    data: {
      clubId: intent.clubId,
      actorUserId: null,
      action: 'payment.webhook.received',
      entityType: 'payment_intent',
      entityId: intent.id,
      metadata: JSON.stringify({
        requestedStatus: params.status,
        providerRef: intent.providerRef,
        orderId: intent.orderId,
      }),
    },
  })

  if (params.status === 'FAILED' || params.status === 'CANCELED') {
    if (
      intent.status === PaymentIntentStatus.PAID ||
      intent.order.status === OrderStatus.COMPLETED
    ) {
      return { intentId: intent.id, orderId: intent.orderId, status: 'PAID' as const }
    }
    const updated = await prisma.$transaction(async (tx) => {
      const nextStatus =
        params.status === 'FAILED'
          ? PaymentIntentStatus.FAILED
          : PaymentIntentStatus.CANCELED
      const current = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: nextStatus },
      })
      await tx.order.update({
        where: { id: intent.orderId },
        data: { status: OrderStatus.FAILED },
      })
      await tx.auditLog.create({
        data: {
          clubId: intent.clubId,
          actorUserId: null,
          action: 'payment.failed',
          entityType: 'payment_intent',
          entityId: intent.id,
          metadata: JSON.stringify({
            providerRef: intent.providerRef,
            orderId: intent.orderId,
          }),
        },
      })
      return current
    })
    return { intent: updated, orderId: intent.orderId, status: 'FAILED' as const }
  }

  if (intent.status === PaymentIntentStatus.PAID && intent.order.status === OrderStatus.COMPLETED) {
    return { intentId: intent.id, orderId: intent.orderId, status: 'PAID' as const }
  }

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: PaymentIntentStatus.PAID,
      paidAt: new Date(),
    },
  })

  const finalized = await finalizeOwnedOrder({
    orderId: intent.orderId,
    userId: intent.userId,
    paymentMode: 'ONLINE',
    providerRef: intent.providerRef,
    paymentIntentId: intent.id,
    markPaid: true,
  })

  await prisma.auditLog.create({
    data: {
      clubId: intent.clubId,
      actorUserId: null,
      action: 'payment.paid',
      entityType: 'payment_intent',
      entityId: intent.id,
      metadata: JSON.stringify({
        providerRef: intent.providerRef,
        orderId: intent.orderId,
        finalized,
      }),
    },
  })

  return { intentId: intent.id, orderId: intent.orderId, status: 'PAID' as const }
}

export async function markOfflineOrderPaidByStaff(params: {
  orderId: string
  actorUserId: string
  reason?: string | null
}) {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: {
        bookings: {
          orderBy: [{ id: 'asc' }],
        },
        payments: {
          orderBy: [{ id: 'asc' }],
        },
      },
    })
    if (!order) {
      throw new CommerceError('ORDER_NOT_FOUND', 404, 'Order not found.')
    }
    if (
      order.status === OrderStatus.CANCELED ||
      order.status === OrderStatus.EXPIRED ||
      order.status === OrderStatus.FAILED
    ) {
      throw new CommerceError('ORDER_NOT_PAYABLE', 409, 'Order is no longer payable.')
    }
    if (order.bookings.length < 1) {
      throw new CommerceError(
        'ORDER_NOT_CONFIRMABLE',
        409,
        'Order has no issued bookings to mark as paid.',
      )
    }

    const existingPaymentByBookingId = new Map(order.payments.map((item) => [item.bookingId, item]))
    for (const booking of order.bookings) {
      const payment = existingPaymentByBookingId.get(booking.id)
      if (!payment) {
        await tx.payment.create({
          data: {
            clubId: order.clubId,
            bookingId: booking.id,
            orderId: order.id,
            amountCents: booking.priceTotalCents ?? 0,
            method: 'OFFLINE_PAY_AT_VENUE',
            status: PaymentStatus.PAID,
            markedByUserId: params.actorUserId,
          },
        })
      }
    }

    await tx.payment.updateMany({
      where: {
        orderId: order.id,
        status: { not: PaymentStatus.PAID },
      },
      data: {
        status: PaymentStatus.PAID,
        markedByUserId: params.actorUserId,
      },
    })

    await tx.booking.updateMany({
      where: {
        orderId: order.id,
        paymentStatus: { not: PaymentStatus.PAID },
      },
      data: {
        paymentStatus: PaymentStatus.PAID,
      },
    })

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.COMPLETED,
        completedAt: order.completedAt || now,
        expiresAt: null,
      },
    })

    const invoice = await issueInvoiceForOrderTx({
      tx,
      orderId: order.id,
      actorUserId: params.actorUserId,
    })

    await tx.auditLog.create({
      data: {
        clubId: order.clubId,
        actorUserId: params.actorUserId,
        action: 'payment.marked_paid',
        entityType: 'order',
        entityId: order.id,
        metadata: JSON.stringify({
          reason: params.reason || null,
          invoiceId: invoice.id,
        }),
      },
    })

    return {
      orderId: order.id,
      invoiceId: invoice.id,
      bookingIds: order.bookings.map((item) => item.id),
      status: OrderStatus.COMPLETED,
    }
  })
}

export async function expireStaleOrders(params?: {
  now?: Date
  limit?: number
  includeAwaitingOffline?: boolean
}) {
  const now = params?.now || new Date()
  const limit = Math.max(1, Math.min(params?.limit || 200, 1000))
  const eligibleStatuses = params?.includeAwaitingOffline
    ? [OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT, OrderStatus.AWAITING_OFFLINE_PAYMENT]
    : [OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT]

  const candidates = await prisma.order.findMany({
    where: {
      status: { in: eligibleStatuses },
      expiresAt: { lte: now },
    },
    select: { id: true, clubId: true, userId: true },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  })
  if (candidates.length < 1) {
    return {
      scanned: 0,
      expiredOrders: 0,
      expiredHolds: 0,
      orderIds: [] as string[],
    }
  }

  const orderIds = candidates.map((item) => item.id)
  const byOrderClubId = new Map(candidates.map((item) => [item.id, item.clubId]))
  const holdIdsByOrder = await prisma.hold.findMany({
    where: { orderId: { in: orderIds }, status: HoldStatus.ACTIVE },
    select: { id: true, orderId: true },
  })

  const result = await prisma.$transaction(async (tx) => {
    const expiredHolds = await tx.hold.updateMany({
      where: { orderId: { in: orderIds }, status: HoldStatus.ACTIVE },
      data: { status: HoldStatus.EXPIRED, canceledAtUtc: now, canceledByUserId: null },
    })
    await tx.paymentIntent.updateMany({
      where: { orderId: { in: orderIds }, status: PaymentIntentStatus.PENDING },
      data: { status: PaymentIntentStatus.EXPIRED },
    })
    const expiredOrders = await tx.order.updateMany({
      where: { id: { in: orderIds }, status: { in: eligibleStatuses } },
      data: { status: OrderStatus.EXPIRED, expiresAt: now },
    })
    await tx.auditLog.createMany({
      data: orderIds.map((orderId) => ({
        clubId: byOrderClubId.get(orderId) || null,
        actorUserId: null,
        action: 'order.expired',
        entityType: 'order',
        entityId: orderId,
      })),
    })
    return {
      expiredOrders: expiredOrders.count,
      expiredHolds: expiredHolds.count,
    }
  })

  return {
    scanned: candidates.length,
    expiredOrders: result.expiredOrders,
    expiredHolds: result.expiredHolds,
    orderIds,
    holdIds: holdIdsByOrder.map((item) => item.id),
  }
}

export async function reconcilePendingPaymentIntents(params?: {
  now?: Date
  olderThanMinutes?: number
  limit?: number
}) {
  const now = params?.now || new Date()
  const olderThanMinutes = Math.max(0, Number(params?.olderThanMinutes ?? 5))
  const threshold = new Date(now.getTime() - olderThanMinutes * 60_000)
  const limit = Math.max(1, Math.min(params?.limit || 200, 1000))

  const intents = await prisma.paymentIntent.findMany({
    where: {
      status: PaymentIntentStatus.PENDING,
      createdAt: { lte: threshold },
    },
    select: {
      id: true,
      provider: true,
      providerRef: true,
      orderId: true,
      clubId: true,
      payloadJson: true,
      expiresAt: true,
    },
    orderBy: [{ createdAt: 'asc' }],
    take: limit,
  })

  let resolved = 0
  const resolvedIntentIds: string[] = []
  const unresolvedIntentIds: string[] = []

  for (const intent of intents) {
    let desiredStatus: 'PAID' | 'FAILED' | 'CANCELED' | null = null
    try {
      if (intent.payloadJson) {
        const parsed = JSON.parse(intent.payloadJson) as { mockProviderStatus?: string }
        const mockStatus = (parsed.mockProviderStatus || '').toUpperCase()
        if (mockStatus === 'PAID' || mockStatus === 'FAILED' || mockStatus === 'CANCELED') {
          desiredStatus = mockStatus
        }
      }
    } catch {
      // ignore malformed payload
    }
    if (!desiredStatus && intent.expiresAt && intent.expiresAt <= now) {
      desiredStatus = 'FAILED'
    }
    if (!desiredStatus) {
      unresolvedIntentIds.push(intent.id)
      continue
    }

    try {
      await processPaymentWebhook({
        intentId: intent.id,
        status: desiredStatus,
        provider: intent.provider,
      })
      await prisma.auditLog.create({
        data: {
          clubId: intent.clubId,
          actorUserId: null,
          action: 'reconciliation.intent.resolved',
          entityType: 'payment_intent',
          entityId: intent.id,
          metadata: JSON.stringify({
            orderId: intent.orderId,
            resolvedStatus: desiredStatus,
          }),
        },
      })
      resolved += 1
      resolvedIntentIds.push(intent.id)
    } catch (error) {
      unresolvedIntentIds.push(intent.id)
      await prisma.auditLog.create({
        data: {
          clubId: intent.clubId,
          actorUserId: null,
          action: 'reconciliation.intent.failed',
          entityType: 'payment_intent',
          entityId: intent.id,
          metadata: JSON.stringify({
            orderId: intent.orderId,
            desiredStatus,
            error:
              error instanceof CommerceError
                ? { code: error.code, message: error.message }
                : { message: 'Unknown reconciliation error.' },
          }),
        },
      })
    }
  }

  return {
    scanned: intents.length,
    resolved,
    unresolved: unresolvedIntentIds.length,
    resolvedIntentIds,
    unresolvedIntentIds,
  }
}
