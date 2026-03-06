import { NextResponse } from 'next/server'
import {
  SCENARIO_LINK_TYPES,
  SCENARIO_STATUS_VALUES,
  type CoverageVerdict,
  type ScenarioLinkType,
  type ScenarioStatus,
} from '@/src/lib/scenarioGovernance'
import { adminErrorResponse, asTrimmedString } from '@/src/lib/platformAdminApi'

const SCENARIO_STATUS_SET = new Set<number>(SCENARIO_STATUS_VALUES)
const SCENARIO_LINK_TYPE_SET = new Set<string>(SCENARIO_LINK_TYPES)

export function parseScenarioStatus(value: unknown): ScenarioStatus | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.trunc(parsed)
  if (!SCENARIO_STATUS_SET.has(normalized)) return null
  return normalized as ScenarioStatus
}

export function parseCoverageVerdict(value: unknown): CoverageVerdict | null {
  if (value === 'Missing' || value === 'Partial' || value === 'Covered') {
    return value
  }
  const normalized = asTrimmedString(value)?.toLowerCase()
  if (normalized === 'missing') return 'Missing'
  if (normalized === 'covered') return 'Covered'
  if (normalized === 'partial') return 'Partial'
  return null
}

export function parseScenarioLinkType(value: unknown): ScenarioLinkType | null {
  const normalized = asTrimmedString(value)?.toUpperCase() ?? ''
  if (!normalized || !SCENARIO_LINK_TYPE_SET.has(normalized)) return null
  return normalized as ScenarioLinkType
}

export function parseNumberArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
}

export function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asTrimmedString(item))
    .filter((item): item is string => item != null)
}

export function parseBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
}

export function scenarioGovernanceErrorResponse(error: unknown) {
  if (error instanceof Error) {
    const message = error.message
    const normalized = message.toLowerCase()
    if (normalized.includes('not found')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (normalized.includes('already exists')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (
      normalized.includes('required') ||
      normalized.includes('invalid') ||
      normalized.includes('cannot mark scenario')
    ) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }
  return adminErrorResponse(error)
}
