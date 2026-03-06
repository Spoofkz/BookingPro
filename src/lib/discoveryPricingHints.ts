import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export async function refreshClubStartingFromHint(params: {
  db: DbClient
  clubId: string
  pricingVersionId: string
}) {
  const version = await params.db.pricingVersion.findFirst({
    where: {
      id: params.pricingVersionId,
      clubId: params.clubId,
    },
    select: {
      id: true,
      rules: {
        select: {
          scopeType: true,
          scopeId: true,
          ruleType: true,
          setRatePerHourCents: true,
        },
      },
    },
  })

  if (!version) return

  const baseRates = version.rules
    .filter(
      (rule) =>
        rule.ruleType === 'BASE_RATE' &&
        rule.scopeType === 'SEGMENT' &&
        rule.setRatePerHourCents != null &&
        rule.setRatePerHourCents > 0,
    )
    .map((rule) => ({
      segmentId: rule.scopeId,
      amount: rule.setRatePerHourCents as number,
    }))

  if (baseRates.length < 1) {
    await params.db.club.update({
      where: { id: params.clubId },
      data: {
        startingFromAmount: null,
        startingFromSegment: null,
      },
    })
    return
  }

  baseRates.sort((left, right) => left.amount - right.amount)
  const minRate = baseRates[0]
  const segment = await params.db.segment.findFirst({
    where: {
      id: minRate.segmentId,
      clubId: params.clubId,
    },
    select: {
      name: true,
    },
  })

  await params.db.club.update({
    where: { id: params.clubId },
    data: {
      startingFromAmount: minRate.amount,
      startingFromSegment: segment?.name ?? minRate.segmentId,
    },
  })
}

