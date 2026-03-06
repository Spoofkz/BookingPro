import {
  ChannelType,
  CustomerType,
  PricingRuleFixedMode,
  PricingRuleType,
  PricingVersionStatus,
  Role,
} from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCabinetContext } from '@/src/lib/cabinetContext'
import { prisma } from '@/src/lib/prisma'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ pricingVersionId: string }>
}

type RuleInput = {
  ruleType: PricingRuleType
  priority?: number
  scopeType: 'SEGMENT' | 'ROOM'
  scopeId: string | number
  dayOfWeek?: number[]
  timeWindowStartMinute?: number
  timeWindowEndMinute?: number
  channel?: ChannelType
  customerType?: CustomerType
  setRatePerHourCents?: number
  addPercent?: number
  addFixedAmountCents?: number
  addFixedMode?: PricingRuleFixedMode
  exclusive?: boolean
  label?: string
}

type ReplaceRulesBody = {
  rules: RuleInput[]
}

type ExpandedInterval = {
  day: number
  startMinute: number
  endMinute: number
}

function validateRule(rule: RuleInput) {
  if (!rule.scopeType || !rule.scopeId) {
    return 'scopeType and scopeId are required.'
  }

  if (rule.ruleType === PricingRuleType.BASE_RATE || rule.ruleType === PricingRuleType.OVERRIDE) {
    if (!Number.isInteger(rule.setRatePerHourCents) || (rule.setRatePerHourCents ?? 0) < 0) {
      return `${rule.ruleType} requires setRatePerHourCents.`
    }
  }

  if (rule.ruleType === PricingRuleType.TIME_MODIFIER) {
    const hasPercent = typeof rule.addPercent === 'number'
    const hasFixed = Number.isInteger(rule.addFixedAmountCents)
    if (!hasPercent && !hasFixed) {
      return 'TIME_MODIFIER requires addPercent or addFixedAmountCents.'
    }
    if (hasFixed && !rule.addFixedMode) {
      return 'TIME_MODIFIER with addFixedAmountCents requires addFixedMode.'
    }
  }

  return null
}

function csvFromNumberArray(values?: number[]) {
  if (!values || values.length === 0) return null
  return values.map((value) => String(value)).join(',')
}

function parseDays(values?: number[]) {
  if (!values || values.length < 1) return [0, 1, 2, 3, 4, 5, 6]
  const parsed = values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [0, 1, 2, 3, 4, 5, 6]
}

function minutesValid(value: number | undefined) {
  return value != null && Number.isInteger(value) && value >= 0 && value < 24 * 60
}

function intervalsForRule(rule: RuleInput): ExpandedInterval[] {
  const days = parseDays(rule.dayOfWeek)
  const startRaw = rule.timeWindowStartMinute
  const endRaw = rule.timeWindowEndMinute
  const intervals: ExpandedInterval[] = []

  if (!minutesValid(startRaw) || !minutesValid(endRaw) || startRaw === endRaw) {
    for (const day of days) {
      intervals.push({ day, startMinute: 0, endMinute: 24 * 60 })
    }
    return intervals
  }
  const start = startRaw as number
  const end = endRaw as number

  if (start < end) {
    for (const day of days) {
      intervals.push({ day, startMinute: start, endMinute: end })
    }
    return intervals
  }

  for (const day of days) {
    intervals.push({ day, startMinute: start, endMinute: 24 * 60 })
    intervals.push({ day: (day + 1) % 7, startMinute: 0, endMinute: end })
  }
  return intervals
}

function overlapIntervals(left: ExpandedInterval, right: ExpandedInterval) {
  if (left.day !== right.day) return false
  return left.startMinute < right.endMinute && left.endMinute > right.startMinute
}

function overlapKey(rule: RuleInput) {
  return [
    rule.scopeType,
    String(rule.scopeId),
    rule.priority ?? 0,
    rule.channel ?? '*',
    rule.customerType ?? '*',
  ].join('|')
}

function ambiguousTimeModifierOverlaps(rules: RuleInput[]) {
  const relevant = rules.filter((rule) => rule.ruleType === PricingRuleType.TIME_MODIFIER)
  const grouped = new Map<string, RuleInput[]>()
  for (const rule of relevant) {
    const key = overlapKey(rule)
    const existing = grouped.get(key) ?? []
    existing.push(rule)
    grouped.set(key, existing)
  }

  const issues: string[] = []
  for (const [key, group] of grouped) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i]
        const right = group[j]
        const leftIntervals = intervalsForRule(left)
        const rightIntervals = intervalsForRule(right)
        const overlaps = leftIntervals.some((leftInterval) =>
          rightIntervals.some((rightInterval) => overlapIntervals(leftInterval, rightInterval)),
        )
        if (!overlaps) continue
        const leftLabel = left.label?.trim() || `${left.ruleType}#${i + 1}`
        const rightLabel = right.label?.trim() || `${right.ruleType}#${j + 1}`
        issues.push(`Rules "${leftLabel}" and "${rightLabel}" overlap for ${key}.`)
      }
    }
  }

  return issues
}

export async function PUT(request: NextRequest, routeContext: RouteContext) {
  const { pricingVersionId } = await routeContext.params
  const context = await getCabinetContext()

  const pricingVersion = await prisma.pricingVersion.findUnique({
    where: { id: pricingVersionId },
  })

  if (!pricingVersion) {
    return NextResponse.json({ error: 'Pricing version not found.' }, { status: 404 })
  }

  const canManage = context.roles.some(
    (role) => role.clubId === pricingVersion.clubId && role.role === Role.TECH_ADMIN,
  )
  if (!canManage) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  if (pricingVersion.status !== PricingVersionStatus.DRAFT) {
    return NextResponse.json(
      {
        code: 'INVALID_STATE_TRANSITION',
        error: 'Only draft pricing versions can be edited.',
      },
      { status: 409 },
    )
  }

  let body: ReplaceRulesBody
  try {
    body = (await request.json()) as ReplaceRulesBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  if (!Array.isArray(body.rules)) {
    return NextResponse.json({ error: 'rules array is required.' }, { status: 400 })
  }

  for (const rule of body.rules) {
    const validationError = validateRule(rule)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }
  }

  const segmentScopeIds = body.rules
    .filter((rule) => rule.scopeType === 'SEGMENT')
    .map((rule) => String(rule.scopeId))
  if (segmentScopeIds.length > 0) {
    const segmentCount = await prisma.segment.count({
      where: {
        clubId: pricingVersion.clubId,
        id: { in: segmentScopeIds },
      },
    })
    if (segmentCount !== segmentScopeIds.length) {
      return NextResponse.json({ error: 'One or more segment scopeIds are invalid.' }, { status: 400 })
    }
  }

  const roomScopeIds = body.rules
    .filter((rule) => rule.scopeType === 'ROOM')
    .map((rule) => Number(rule.scopeId))
  if (roomScopeIds.length > 0) {
    const roomCount = await prisma.room.count({
      where: {
        clubId: pricingVersion.clubId,
        id: { in: roomScopeIds },
      },
    })
    if (roomCount !== roomScopeIds.length) {
      return NextResponse.json({ error: 'One or more room scopeIds are invalid.' }, { status: 400 })
    }
  }

  const overlapIssues = ambiguousTimeModifierOverlaps(body.rules)
  if (overlapIssues.length > 0) {
    return NextResponse.json(
      {
        code: 'VALIDATION_ERROR',
        error: 'Ambiguous TIME_MODIFIER overlap detected.',
        details: overlapIssues,
      },
      { status: 409 },
    )
  }

  const replaced = await prisma.$transaction(async (tx) => {
    await tx.pricingRule.deleteMany({
      where: { pricingVersionId: pricingVersion.id },
    })

    for (const rule of body.rules) {
      await tx.pricingRule.create({
        data: {
          pricingVersionId: pricingVersion.id,
          ruleType: rule.ruleType,
          priority: rule.priority ?? 0,
          scopeType: rule.scopeType,
          scopeId: String(rule.scopeId),
          dayOfWeekCsv: csvFromNumberArray(rule.dayOfWeek),
          timeWindowStartMinute: rule.timeWindowStartMinute ?? null,
          timeWindowEndMinute: rule.timeWindowEndMinute ?? null,
          channel: rule.channel,
          customerType: rule.customerType,
          setRatePerHourCents: rule.setRatePerHourCents,
          addPercent: rule.addPercent,
          addFixedAmountCents: rule.addFixedAmountCents,
          addFixedMode: rule.addFixedMode,
          exclusive: rule.exclusive ?? false,
          label: rule.label?.trim() || null,
        },
      })
    }

    return tx.pricingVersion.findUnique({
      where: { id: pricingVersion.id },
      include: {
        rules: {
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
  })

  return NextResponse.json(replaced)
}
