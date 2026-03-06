import { Customer, CustomerRecordStatus, Prisma } from '@prisma/client'
import { normalizePhone } from '@/src/lib/authSession'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ResolveCustomerForBookingInput = {
  clubId: string
  actorUserId: string | null
  source: 'booking.create' | 'hold.confirm'
  displayName?: string | null
  phone?: string | null
  email?: string | null
  linkedUserId?: string | null
}

type ResolveCustomerForBookingResult = {
  customer: Customer | null
  normalizedPhone: string | null
}

function asTrimmedValue(input: string | null | undefined, maxLength: number) {
  const value = (input || '').trim()
  if (!value) return null
  return value.slice(0, maxLength)
}

export function normalizeCustomerDisplayName(input: string | null | undefined) {
  return asTrimmedValue(input, 120)
}

export function normalizeCustomerPhone(input: string | null | undefined) {
  const value = (input || '').trim()
  if (!value) return null
  return normalizePhone(value)
}

export function normalizeCustomerEmail(input: string | null | undefined) {
  const value = (input || '').trim().toLowerCase()
  if (!value) return null
  if (value.endsWith('@local.invalid')) return null
  if (!EMAIL_PATTERN.test(value)) return null
  return value
}

export function normalizeCustomerTag(input: string | null | undefined) {
  const value = (input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40)
  return value || null
}

export function normalizeAttentionReason(input: string | null | undefined) {
  return asTrimmedValue(input, 240)
}

export function maskCustomerPhone(input: string | null | undefined) {
  const value = (input || '').trim()
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  const last4 = digits.slice(-4)
  return `***${last4}`
}

export function maskCustomerEmail(input: string | null | undefined) {
  const value = (input || '').trim().toLowerCase()
  if (!value) return null
  const [local, domain] = value.split('@')
  if (!local || !domain) return '***'
  const keep = local.slice(0, Math.min(2, local.length))
  return `${keep}***@${domain}`
}

export function isPrismaUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function writeCustomerAudit(
  tx: Prisma.TransactionClient,
  params: {
    clubId: string
    actorUserId: string | null
    action: string
    customerId: string
    metadata?: Record<string, unknown>
  },
) {
  await tx.auditLog.create({
    data: {
      clubId: params.clubId,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: 'customer',
      entityId: params.customerId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  })
}

async function updateCustomerAfterConflict(
  tx: Prisma.TransactionClient,
  params: {
    customer: Customer
    displayName: string | null
    email: string | null
    linkedUserId: string | null
  },
) {
  const patch: Prisma.CustomerUncheckedUpdateInput = {}
  if (params.displayName && params.customer.displayName !== params.displayName) {
    patch.displayName = params.displayName
  }
  if (params.email && params.customer.email !== params.email) {
    patch.email = params.email
  }
  if (params.linkedUserId && params.customer.linkedUserId !== params.linkedUserId) {
    patch.linkedUserId = params.linkedUserId
  }
  if (params.customer.status !== CustomerRecordStatus.ACTIVE) {
    patch.status = CustomerRecordStatus.ACTIVE
  }
  if (Object.keys(patch).length === 0) {
    return params.customer
  }
  return tx.customer.update({
    where: { id: params.customer.id },
    data: patch,
  })
}

export async function resolveOrCreateCustomerForBooking(
  tx: Prisma.TransactionClient,
  input: ResolveCustomerForBookingInput,
): Promise<ResolveCustomerForBookingResult> {
  const displayName = normalizeCustomerDisplayName(input.displayName)
  const normalizedPhone = normalizeCustomerPhone(input.phone)
  const email = normalizeCustomerEmail(input.email)
  const linkedUserId = asTrimmedValue(input.linkedUserId, 64)

  if (!displayName && !normalizedPhone && !email && !linkedUserId) {
    return { customer: null, normalizedPhone: null }
  }

  let customer: Customer | null = null
  if (normalizedPhone) {
    customer = await tx.customer.findUnique({
      where: {
        clubId_phone: {
          clubId: input.clubId,
          phone: normalizedPhone,
        },
      },
    })
  }
  if (!customer && linkedUserId) {
    customer = await tx.customer.findFirst({
      where: {
        clubId: input.clubId,
        linkedUserId,
        status: { not: CustomerRecordStatus.DELETED },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }
  if (!customer && email) {
    customer = await tx.customer.findFirst({
      where: {
        clubId: input.clubId,
        email,
        status: { not: CustomerRecordStatus.DELETED },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }

  if (!customer) {
    try {
      const created = await tx.customer.create({
        data: {
          clubId: input.clubId,
          displayName,
          phone: normalizedPhone,
          email,
          linkedUserId,
          createdByUserId: input.actorUserId,
          status: CustomerRecordStatus.ACTIVE,
        },
      })
      await writeCustomerAudit(tx, {
        clubId: input.clubId,
        actorUserId: input.actorUserId,
        action: 'customer.created',
        customerId: created.id,
        metadata: {
          source: input.source,
          via: normalizedPhone ? 'phone' : linkedUserId ? 'linkedUser' : 'manual',
        },
      })
      if (linkedUserId) {
        await writeCustomerAudit(tx, {
          clubId: input.clubId,
          actorUserId: input.actorUserId,
          action: 'customer.linked',
          customerId: created.id,
          metadata: {
            source: input.source,
            linkedUserId,
          },
        })
      }
      return { customer: created, normalizedPhone }
    } catch (error) {
      if (!isPrismaUniqueViolation(error) || !normalizedPhone) {
        throw error
      }

      const existingByPhone = await tx.customer.findUnique({
        where: {
          clubId_phone: {
            clubId: input.clubId,
            phone: normalizedPhone,
          },
        },
      })
      if (!existingByPhone) {
        throw error
      }
      const recovered = await updateCustomerAfterConflict(tx, {
        customer: existingByPhone,
        displayName,
        email,
        linkedUserId,
      })
      return { customer: recovered, normalizedPhone }
    }
  }

  const previousLinkedUserId = customer.linkedUserId
  const updates: Prisma.CustomerUncheckedUpdateInput = {}
  const changedFields: string[] = []

  if (displayName && customer.displayName !== displayName) {
    updates.displayName = displayName
    changedFields.push('displayName')
  }
  if (email && customer.email !== email) {
    updates.email = email
    changedFields.push('email')
  }
  if (normalizedPhone && customer.phone !== normalizedPhone) {
    updates.phone = normalizedPhone
    changedFields.push('phone')
  }
  if (linkedUserId && customer.linkedUserId !== linkedUserId) {
    updates.linkedUserId = linkedUserId
    changedFields.push('linkedUserId')
  }
  if (customer.status !== CustomerRecordStatus.ACTIVE) {
    updates.status = CustomerRecordStatus.ACTIVE
    changedFields.push('status')
  }

  if (Object.keys(updates).length > 0) {
    try {
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: updates,
      })
      await writeCustomerAudit(tx, {
        clubId: input.clubId,
        actorUserId: input.actorUserId,
        action: 'customer.updated',
        customerId: customer.id,
        metadata: {
          source: input.source,
          changedFields,
        },
      })
    } catch (error) {
      if (!isPrismaUniqueViolation(error) || !normalizedPhone) {
        throw error
      }
      const existingByPhone = await tx.customer.findUnique({
        where: {
          clubId_phone: {
            clubId: input.clubId,
            phone: normalizedPhone,
          },
        },
      })
      if (!existingByPhone) {
        throw error
      }
      customer = await updateCustomerAfterConflict(tx, {
        customer: existingByPhone,
        displayName,
        email,
        linkedUserId,
      })
    }
  }

  if (linkedUserId && previousLinkedUserId !== linkedUserId) {
    await writeCustomerAudit(tx, {
      clubId: input.clubId,
      actorUserId: input.actorUserId,
      action: 'customer.linked',
      customerId: customer.id,
      metadata: {
        source: input.source,
        previousLinkedUserId,
        linkedUserId,
      },
    })
  }

  return { customer, normalizedPhone }
}
