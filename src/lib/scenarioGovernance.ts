import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const SCENARIO_STATUS_VALUES = [0, 50, 100] as const
export type ScenarioStatus = (typeof SCENARIO_STATUS_VALUES)[number]
export type CoverageVerdict = 'Missing' | 'Partial' | 'Covered'

export const SCENARIO_LINK_TYPES = ['PRD', 'AC', 'TEST', 'EVIDENCE', 'BACKLOG'] as const
export type ScenarioLinkType = (typeof SCENARIO_LINK_TYPES)[number]

const REQUIRED_LINK_TYPES_FOR_COVERED: ScenarioLinkType[] = ['PRD', 'AC', 'TEST', 'EVIDENCE']

export type ScenarioLink = {
  linkId: string
  linkType: ScenarioLinkType
  title: string
  url: string
  createdAt: string
}

export type ScenarioRecord = {
  id: string
  scenarioId: string
  name: string
  outcome: string
  ownerMilestone: number
  dependencies: number[]
  mvpScope: boolean
  status: ScenarioStatus
  nfrTags: string[]
  notes: string
  gapNote: string
  negativeCaseVerified: boolean
  links: ScenarioLink[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type ScenarioVerificationRun = {
  runId: string
  scenarioId: string
  runAt: string
  environment: string
  verdict: CoverageVerdict
  notes: string
  artifactUrl: string
  negativeCaseRecorded: boolean
  createdBy: string | null
}

export type MilestoneItem = {
  id: number
  name: string
  codexPercent: number
  status: string
}

type PolicyChecklist = {
  ttlExpiry?: boolean
  concurrencyConflict?: boolean
  forbiddenAction?: boolean
  invalidStateTransition?: boolean
  idempotencyRetry?: boolean
  externalIntegrationFailure?: boolean
}

type SecurityAuditObservability = {
  rbacTenancyProven?: boolean
  auditVisible?: boolean
  logsMetricsEvidence?: boolean
}

type TestsReleaseSignals = {
  testsEvidence?: boolean
  ciOrStagingEvidence?: boolean
}

type MilestoneScorecardEntry = {
  policyFailureChecklist?: PolicyChecklist
  securityAuditObservability?: SecurityAuditObservability
  testsReleaseSignals?: TestsReleaseSignals
}

export type MilestoneReadinessSnapshot = {
  milestoneId: number
  milestoneName: string
  codexScore: number
  evidenceScore: number
  delta: number
  computedAt: string
  breakdown: {
    ownedCoveragePoints: number
    policyFailurePoints: number
    securityAuditObsPoints: number
    testsReleasePoints: number
    ownedCovered: number
    ownedTotal: number
  }
  reasons: string[]
}

export type ScenarioCompleteness = {
  scenarioId: string
  acLinked: boolean
  testsLinked: boolean
  evidenceLinked: boolean
  negativeCaseLinked: boolean
  coverageVerdict: CoverageVerdict
  missingItems: string[]
}

export type ScenarioMatrixAItem = {
  scenarioId: string
  ownerMilestone: number
  dependencyMilestones: number[]
  ownerPrdSectionPresent: boolean
  notes: string
}

function resolveDataDir() {
  const override = safeTrim(process.env.SCENARIO_GOV_DATA_DIR)
  if (!override) {
    return path.join(process.cwd(), 'docs', 'scenario-governance', 'data')
  }
  return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override)
}

const DATA_DIR = resolveDataDir()
const V3_SCENARIO_FILE = path.join(DATA_DIR, 'scenario-register-v3.json')
const LEGACY_SCENARIO_FILE = path.join(DATA_DIR, 'scenario-register.json')
const VERIFICATION_RUNS_FILE = path.join(DATA_DIR, 'scenario-verification-runs.json')
const SNAPSHOTS_FILE = path.join(DATA_DIR, 'milestone-readiness-snapshots.json')
const MILESTONES_FILE = path.join(DATA_DIR, 'milestones.json')
const SCORECARDS_FILE = path.join(DATA_DIR, 'milestone-scorecards.json')

const CHECKLIST_KEYS: Array<keyof Required<PolicyChecklist>> = [
  'ttlExpiry',
  'concurrencyConflict',
  'forbiddenAction',
  'invalidStateTransition',
  'idempotencyRetry',
  'externalIntegrationFailure',
]

function nowIso() {
  return new Date().toISOString()
}

function safeTrim(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function toScenarioStatus(value: unknown): ScenarioStatus {
  const parsed = Number(value)
  if (parsed === 100) return 100
  if (parsed === 50) return 50
  return 0
}

function id(prefix: string) {
  const raw = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${raw}`
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile<T>(filePath: string, value: T) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function toScenarioLinkType(value: unknown): ScenarioLinkType | null {
  const upper = safeTrim(value).toUpperCase()
  if (!upper) return null
  if ((SCENARIO_LINK_TYPES as readonly string[]).includes(upper)) {
    return upper as ScenarioLinkType
  }
  return null
}

function normalizeLinks(raw: unknown): ScenarioLink[] {
  if (!Array.isArray(raw)) return []
  const normalized: ScenarioLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const linkType = toScenarioLinkType(record.linkType)
    const title = safeTrim(record.title)
    const url = safeTrim(record.url)
    if (!linkType || !title || !url) continue
    normalized.push({
      linkId: safeTrim(record.linkId) || id('lnk'),
      linkType,
      title,
      url,
      createdAt: safeTrim(record.createdAt) || nowIso(),
    })
  }
  return normalized
}

function linksFromLegacyScenario(raw: Record<string, unknown>): ScenarioLink[] {
  const next: ScenarioLink[] = []
  const now = nowIso()

  const pushFromArray = (linkType: ScenarioLinkType, field: string) => {
    const values = Array.isArray(raw[field]) ? (raw[field] as unknown[]) : []
    values.forEach((value, index) => {
      const text = safeTrim(value)
      if (!text) return
      next.push({
        linkId: id(`${linkType.toLowerCase()}_${index + 1}`),
        linkType,
        title: text,
        url: text,
        createdAt: now,
      })
    })
  }

  pushFromArray('PRD', 'prdLinks')
  pushFromArray('AC', 'acLinks')
  pushFromArray('TEST', 'testIds')
  pushFromArray('EVIDENCE', 'evidenceLinks')

  const backlog = safeTrim(raw.backlogLink)
  if (backlog) {
    next.push({
      linkId: id('backlog'),
      linkType: 'BACKLOG',
      title: backlog,
      url: backlog,
      createdAt: now,
    })
  }
  return next
}

function normalizeScenarioRecord(raw: unknown): ScenarioRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>

  const scenarioId = safeTrim(record.scenarioId)
  if (!scenarioId) return null

  const createdAt = safeTrim(record.createdAt) || nowIso()
  const links = normalizeLinks(record.links)
  const legacyLinks = links.length > 0 ? [] : linksFromLegacyScenario(record)

  return {
    id: safeTrim(record.id) || scenarioId,
    scenarioId,
    name: safeTrim(record.name) || safeTrim(record.scenarioName) || scenarioId,
    outcome: safeTrim(record.outcome),
    ownerMilestone: Number(record.ownerMilestone) || 0,
    dependencies: Array.isArray(record.dependencies)
      ? record.dependencies.map((dep) => Number(dep)).filter((dep) => Number.isInteger(dep) && dep > 0)
      : [],
    mvpScope: Boolean(record.mvpScope),
    status: toScenarioStatus(record.status),
    nfrTags: Array.isArray(record.nfrTags)
      ? record.nfrTags.map((tag) => safeTrim(tag)).filter(Boolean)
      : [],
    notes: safeTrim(record.notes),
    gapNote: safeTrim(record.gapNote),
    negativeCaseVerified: Boolean(record.negativeCaseVerified),
    links: links.length > 0 ? links : legacyLinks,
    createdBy: safeTrim(record.createdBy) || null,
    createdAt,
    updatedAt: safeTrim(record.updatedAt) || createdAt,
  }
}

async function loadScenarioRecordsRaw() {
  const v3 = await readJsonFile<unknown[]>(V3_SCENARIO_FILE, [])
  if (Array.isArray(v3) && v3.length > 0) return v3
  const legacy = await readJsonFile<unknown[]>(LEGACY_SCENARIO_FILE, [])
  return legacy
}

export async function listScenarios() {
  const raw = await loadScenarioRecordsRaw()
  const normalized = raw
    .map((item) => normalizeScenarioRecord(item))
    .filter((item): item is ScenarioRecord => item !== null)
  normalized.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId))
  return normalized
}

export async function saveScenarios(scenarios: ScenarioRecord[]) {
  await writeJsonFile(V3_SCENARIO_FILE, scenarios)
}

export async function listMilestones() {
  return readJsonFile<MilestoneItem[]>(MILESTONES_FILE, [])
}

export async function listScorecards() {
  return readJsonFile<Record<string, MilestoneScorecardEntry>>(SCORECARDS_FILE, {})
}

export async function listVerificationRuns() {
  const runs = await readJsonFile<unknown[]>(VERIFICATION_RUNS_FILE, [])
  const normalized: ScenarioVerificationRun[] = []
  for (const item of runs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const scenarioId = safeTrim(record.scenarioId)
    if (!scenarioId) continue
    normalized.push({
      runId: safeTrim(record.runId) || id('run'),
      scenarioId,
      runAt: safeTrim(record.runAt) || nowIso(),
      environment: safeTrim(record.environment) || 'staging',
      verdict:
        safeTrim(record.verdict) === 'Covered'
          ? 'Covered'
          : safeTrim(record.verdict) === 'Missing'
            ? 'Missing'
            : 'Partial',
      notes: safeTrim(record.notes),
      artifactUrl: safeTrim(record.artifactUrl),
      negativeCaseRecorded: Boolean(record.negativeCaseRecorded),
      createdBy: safeTrim(record.createdBy) || null,
    })
  }
  return normalized.sort((a, b) => b.runAt.localeCompare(a.runAt))
}

async function saveVerificationRuns(runs: ScenarioVerificationRun[]) {
  await writeJsonFile(VERIFICATION_RUNS_FILE, runs)
}

export async function listReadinessSnapshots() {
  const snapshots = await readJsonFile<MilestoneReadinessSnapshot[]>(SNAPSHOTS_FILE, [])
  return snapshots.sort((a, b) => b.computedAt.localeCompare(a.computedAt))
}

async function saveReadinessSnapshots(snapshots: MilestoneReadinessSnapshot[]) {
  await writeJsonFile(SNAPSHOTS_FILE, snapshots)
}

function linkPresence(links: ScenarioLink[]) {
  const set = new Set(links.map((link) => link.linkType))
  return {
    prd: set.has('PRD'),
    ac: set.has('AC'),
    test: set.has('TEST'),
    evidence: set.has('EVIDENCE'),
    backlog: set.has('BACKLOG'),
  }
}

export function buildScenarioCompleteness(
  scenario: ScenarioRecord,
  runs: ScenarioVerificationRun[],
): ScenarioCompleteness {
  const links = linkPresence(scenario.links)
  const scenarioRuns = runs.filter((run) => run.scenarioId === scenario.scenarioId)
  const negativeCaseLinked =
    scenario.negativeCaseVerified || scenarioRuns.some((run) => run.negativeCaseRecorded)

  const missingItems: string[] = []
  if (!links.prd) missingItems.push('PRD link')
  if (!links.ac) missingItems.push('AC link')
  if (!links.test) missingItems.push('TEST link')
  if (!links.evidence) missingItems.push('EVIDENCE link')
  if (!negativeCaseLinked) missingItems.push('Negative case evidence')

  let coverageVerdict: CoverageVerdict = 'Partial'
  if (scenario.status === 0) {
    coverageVerdict = 'Missing'
  } else if (missingItems.length > 0) {
    coverageVerdict = 'Partial'
  } else if (scenario.status === 100) {
    coverageVerdict = 'Covered'
  } else {
    coverageVerdict = 'Partial'
  }

  return {
    scenarioId: scenario.scenarioId,
    acLinked: links.ac,
    testsLinked: links.test,
    evidenceLinked: links.evidence,
    negativeCaseLinked,
    coverageVerdict,
    missingItems,
  }
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function roundInt(value: number) {
  return Math.round(value)
}

export async function buildMatrices() {
  const [scenarios, runs] = await Promise.all([listScenarios(), listVerificationRuns()])
  const matrixA: ScenarioMatrixAItem[] = scenarios.map((scenario) => ({
    scenarioId: scenario.scenarioId,
    ownerMilestone: scenario.ownerMilestone,
    dependencyMilestones: scenario.dependencies,
    ownerPrdSectionPresent: scenario.links.some((link) => link.linkType === 'PRD'),
    notes: scenario.gapNote || scenario.notes || '',
  }))
  const matrixB = scenarios.map((scenario) => buildScenarioCompleteness(scenario, runs))
  return { matrixA, matrixB }
}

function hasAllRequiredLinksForCovered(links: ScenarioLink[]) {
  const types = new Set(links.map((link) => link.linkType))
  return REQUIRED_LINK_TYPES_FOR_COVERED.every((required) => types.has(required))
}

export function canBeMarkedCovered(
  scenario: ScenarioRecord,
  runs: ScenarioVerificationRun[],
) {
  const hasRequiredLinks = hasAllRequiredLinksForCovered(scenario.links)
  const hasNegative = scenario.negativeCaseVerified || runs.some((run) => run.negativeCaseRecorded)
  return {
    allowed: hasRequiredLinks && hasNegative,
    hasRequiredLinks,
    hasNegative,
  }
}

export async function createScenario(input: {
  scenarioId: string
  name: string
  outcome: string
  ownerMilestone: number
  dependencies?: number[]
  mvpScope?: boolean
  status?: ScenarioStatus
  nfrTags?: string[]
  notes?: string
  gapNote?: string
  createdBy?: string | null
}) {
  const scenarios = await listScenarios()
  const scenarioId = safeTrim(input.scenarioId)
  if (!scenarioId) throw new Error('scenarioId is required.')
  if (scenarios.some((scenario) => scenario.scenarioId === scenarioId)) {
    throw new Error(`Scenario ${scenarioId} already exists.`)
  }
  if (!Number.isInteger(input.ownerMilestone) || input.ownerMilestone < 1 || input.ownerMilestone > 24) {
    throw new Error('ownerMilestone is required and must be between 1 and 24.')
  }

  const now = nowIso()
  const next: ScenarioRecord = {
    id: scenarioId,
    scenarioId,
    name: safeTrim(input.name) || scenarioId,
    outcome: safeTrim(input.outcome),
    ownerMilestone: input.ownerMilestone,
    dependencies: (input.dependencies ?? []).filter((dep) => Number.isInteger(dep) && dep > 0),
    mvpScope: input.mvpScope !== false,
    status: toScenarioStatus(input.status),
    nfrTags: (input.nfrTags ?? []).map((tag) => safeTrim(tag)).filter(Boolean),
    notes: safeTrim(input.notes),
    gapNote: safeTrim(input.gapNote),
    negativeCaseVerified: false,
    links: [],
    createdBy: safeTrim(input.createdBy) || null,
    createdAt: now,
    updatedAt: now,
  }

  if (next.status === 100) {
    throw new Error('Scenario cannot be created at 100% Covered without links and negative evidence.')
  }

  scenarios.push(next)
  await saveScenarios(scenarios)
  return next
}

export async function updateScenario(
  scenarioId: string,
  patch: Partial<
    Pick<
      ScenarioRecord,
      | 'name'
      | 'outcome'
      | 'ownerMilestone'
      | 'dependencies'
      | 'mvpScope'
      | 'status'
      | 'nfrTags'
      | 'notes'
      | 'gapNote'
      | 'negativeCaseVerified'
    >
  >,
) {
  const [scenarios, runs] = await Promise.all([listScenarios(), listVerificationRuns()])
  const index = scenarios.findIndex((scenario) => scenario.scenarioId === scenarioId)
  if (index < 0) throw new Error('Scenario not found.')

  const current = scenarios[index]
  const next: ScenarioRecord = {
    ...current,
    name: patch.name != null ? safeTrim(patch.name) || current.name : current.name,
    outcome: patch.outcome != null ? safeTrim(patch.outcome) : current.outcome,
    ownerMilestone:
      patch.ownerMilestone != null && Number.isInteger(patch.ownerMilestone)
        ? Number(patch.ownerMilestone)
        : current.ownerMilestone,
    dependencies:
      patch.dependencies != null
        ? patch.dependencies.filter((dep) => Number.isInteger(dep) && dep > 0)
        : current.dependencies,
    mvpScope: patch.mvpScope != null ? Boolean(patch.mvpScope) : current.mvpScope,
    status: patch.status != null ? toScenarioStatus(patch.status) : current.status,
    nfrTags:
      patch.nfrTags != null ? patch.nfrTags.map((tag) => safeTrim(tag)).filter(Boolean) : current.nfrTags,
    notes: patch.notes != null ? safeTrim(patch.notes) : current.notes,
    gapNote: patch.gapNote != null ? safeTrim(patch.gapNote) : current.gapNote,
    negativeCaseVerified:
      patch.negativeCaseVerified != null
        ? Boolean(patch.negativeCaseVerified)
        : current.negativeCaseVerified,
    updatedAt: nowIso(),
  }

  if (!Number.isInteger(next.ownerMilestone) || next.ownerMilestone < 1 || next.ownerMilestone > 24) {
    throw new Error('ownerMilestone is required and must be between 1 and 24.')
  }

  if (next.status === 100) {
    const gate = canBeMarkedCovered(next, runs.filter((run) => run.scenarioId === next.scenarioId))
    if (!gate.allowed) {
      throw new Error(
        `Cannot mark scenario as Covered. Missing: ${[
          !gate.hasRequiredLinks ? 'required links (PRD/AC/TEST/EVIDENCE)' : null,
          !gate.hasNegative ? 'negative case evidence' : null,
        ]
          .filter(Boolean)
          .join(', ')}`,
      )
    }
  }

  scenarios[index] = next
  await saveScenarios(scenarios)
  return next
}

export async function addScenarioLink(
  scenarioId: string,
  input: { linkType: ScenarioLinkType; title: string; url: string },
) {
  const scenarios = await listScenarios()
  const index = scenarios.findIndex((scenario) => scenario.scenarioId === scenarioId)
  if (index < 0) throw new Error('Scenario not found.')
  const linkType = toScenarioLinkType(input.linkType)
  if (!linkType) throw new Error('linkType is invalid.')

  const title = safeTrim(input.title)
  const url = safeTrim(input.url)
  if (!title || !url) throw new Error('title and url are required.')

  const link: ScenarioLink = {
    linkId: id('lnk'),
    linkType,
    title,
    url,
    createdAt: nowIso(),
  }

  const nextScenario: ScenarioRecord = {
    ...scenarios[index],
    links: [...scenarios[index].links, link],
    updatedAt: nowIso(),
  }
  scenarios[index] = nextScenario
  await saveScenarios(scenarios)
  return link
}

export async function deleteScenarioLink(scenarioId: string, linkId: string) {
  const scenarios = await listScenarios()
  const index = scenarios.findIndex((scenario) => scenario.scenarioId === scenarioId)
  if (index < 0) throw new Error('Scenario not found.')
  const before = scenarios[index]
  const afterLinks = before.links.filter((link) => link.linkId !== linkId)
  if (afterLinks.length === before.links.length) {
    throw new Error('Link not found.')
  }
  scenarios[index] = {
    ...before,
    links: afterLinks,
    updatedAt: nowIso(),
  }
  await saveScenarios(scenarios)
}

export async function addVerificationRun(
  scenarioId: string,
  input: {
    environment: string
    verdict: CoverageVerdict
    notes?: string
    artifactUrl?: string
    negativeCaseRecorded?: boolean
    createdBy?: string | null
  },
) {
  const scenarios = await listScenarios()
  const scenarioIndex = scenarios.findIndex((scenario) => scenario.scenarioId === scenarioId)
  if (scenarioIndex < 0) throw new Error('Scenario not found.')

  const run: ScenarioVerificationRun = {
    runId: id('run'),
    scenarioId,
    runAt: nowIso(),
    environment: safeTrim(input.environment) || 'staging',
    verdict:
      input.verdict === 'Covered' || input.verdict === 'Missing'
        ? input.verdict
        : 'Partial',
    notes: safeTrim(input.notes),
    artifactUrl: safeTrim(input.artifactUrl),
    negativeCaseRecorded: Boolean(input.negativeCaseRecorded),
    createdBy: safeTrim(input.createdBy) || null,
  }

  const runs = await listVerificationRuns()
  runs.unshift(run)
  await saveVerificationRuns(runs)

  if (run.negativeCaseRecorded && !scenarios[scenarioIndex].negativeCaseVerified) {
    scenarios[scenarioIndex] = {
      ...scenarios[scenarioIndex],
      negativeCaseVerified: true,
      updatedAt: nowIso(),
    }
    await saveScenarios(scenarios)
  }

  return run
}

export async function getScenarioById(scenarioId: string) {
  const [scenarios, runs] = await Promise.all([listScenarios(), listVerificationRuns()])
  const scenario = scenarios.find((item) => item.scenarioId === scenarioId) ?? null
  if (!scenario) return null
  const scenarioRuns = runs.filter((run) => run.scenarioId === scenarioId)
  const completeness = buildScenarioCompleteness(scenario, scenarioRuns)
  return { scenario, runs: scenarioRuns, completeness }
}

export async function recomputeMilestoneReadiness() {
  const [milestones, scenarios, scorecards, runs] = await Promise.all([
    listMilestones(),
    listScenarios(),
    listScorecards(),
    listVerificationRuns(),
  ])

  const snapshots: MilestoneReadinessSnapshot[] = milestones.map((milestone) => {
    const owned = scenarios.filter((scenario) => scenario.ownerMilestone === milestone.id)
    const ownedCompletions = owned.map((scenario) => buildScenarioCompleteness(scenario, runs))
    const ownedCovered = ownedCompletions.filter((item) => item.coverageVerdict === 'Covered').length
    const ownedTotal = owned.length
    const ownedCoveragePoints = ownedTotal > 0 ? (ownedCovered / ownedTotal) * 50 : 0

    const card = scorecards[String(milestone.id)] ?? {}
    const checklist = card.policyFailureChecklist ?? {}
    const checklistTrue = CHECKLIST_KEYS.filter((key) => checklist[key] === true).length
    const policyFailurePoints = (checklistTrue / CHECKLIST_KEYS.length) * 20

    const security = card.securityAuditObservability ?? {}
    const securityAuditObsPoints =
      (security.rbacTenancyProven ? 5 : 0) +
      (security.auditVisible ? 5 : 0) +
      (security.logsMetricsEvidence ? 5 : 0)

    const tests = card.testsReleaseSignals ?? {}
    const testsReleasePoints = (tests.testsEvidence ? 10 : 0) + (tests.ciOrStagingEvidence ? 5 : 0)

    const evidenceScore = roundInt(
      ownedCoveragePoints + policyFailurePoints + securityAuditObsPoints + testsReleasePoints,
    )
    const delta = evidenceScore - milestone.codexPercent

    const reasons: string[] = []
    if (ownedTotal > 0 && ownedCovered < ownedTotal) {
      reasons.push(`Only ${ownedCovered}/${ownedTotal} owned scenarios are fully covered.`)
    }
    if (checklistTrue < CHECKLIST_KEYS.length) {
      reasons.push(`Policy/failure checklist is incomplete (${checklistTrue}/${CHECKLIST_KEYS.length}).`)
    }
    if (!security.auditVisible) {
      reasons.push('Audit visibility evidence is missing.')
    }
    if (!security.logsMetricsEvidence) {
      reasons.push('Logs/metrics evidence is missing.')
    }
    if (!tests.testsEvidence) {
      reasons.push('Tests evidence is missing.')
    }
    if (!tests.ciOrStagingEvidence) {
      reasons.push('CI/staging evidence is missing.')
    }

    return {
      milestoneId: milestone.id,
      milestoneName: milestone.name,
      codexScore: milestone.codexPercent,
      evidenceScore,
      delta,
      computedAt: nowIso(),
      breakdown: {
        ownedCoveragePoints: round1(ownedCoveragePoints),
        policyFailurePoints: round1(policyFailurePoints),
        securityAuditObsPoints: round1(securityAuditObsPoints),
        testsReleasePoints: round1(testsReleasePoints),
        ownedCovered,
        ownedTotal,
      },
      reasons,
    }
  })

  await saveReadinessSnapshots(snapshots)
  return snapshots
}

export async function getLatestReadinessByMilestone() {
  const [snapshots, milestones] = await Promise.all([listReadinessSnapshots(), listMilestones()])
  if (snapshots.length < 1) {
    return recomputeMilestoneReadiness()
  }

  const latestByMilestone = new Map<number, MilestoneReadinessSnapshot>()
  for (const snapshot of snapshots) {
    const current = latestByMilestone.get(snapshot.milestoneId)
    if (!current || snapshot.computedAt > current.computedAt) {
      latestByMilestone.set(snapshot.milestoneId, snapshot)
    }
  }

  return milestones
    .map((milestone) => latestByMilestone.get(milestone.id))
    .filter((item): item is MilestoneReadinessSnapshot => item != null)
}

export async function listScenariosFiltered(filters: {
  milestoneId?: number | null
  status?: ScenarioStatus | null
  mvpScope?: boolean | null
  q?: string | null
  tag?: string | null
}) {
  const [scenarios, runs] = await Promise.all([listScenarios(), listVerificationRuns()])
  const q = safeTrim(filters.q).toLowerCase()
  const tag = safeTrim(filters.tag).toLowerCase()

  const items = scenarios.filter((scenario) => {
    if (filters.milestoneId && scenario.ownerMilestone !== filters.milestoneId) return false
    if (filters.status != null && scenario.status !== filters.status) return false
    if (filters.mvpScope != null && scenario.mvpScope !== filters.mvpScope) return false
    if (tag && !scenario.nfrTags.some((item) => item.toLowerCase() === tag)) return false
    if (q) {
      const haystack = `${scenario.scenarioId} ${scenario.name} ${scenario.outcome}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const withCompleteness = items.map((scenario) => ({
    ...scenario,
    completeness: buildScenarioCompleteness(
      scenario,
      runs.filter((run) => run.scenarioId === scenario.scenarioId),
    ),
  }))

  return withCompleteness
}
