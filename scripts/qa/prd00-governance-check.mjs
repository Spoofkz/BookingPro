#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DATA_DIR = path.join(ROOT, 'docs', 'scenario-governance', 'data')
const OUT_DIR = path.join(ROOT, 'docs', 'scenario-governance', 'generated')
const WRITE = process.argv.includes('--write')

const ALLOWED_SCENARIO_STATUS = new Set([0, 50, 100])
const CHECKLIST_KEYS = [
  'ttlExpiry',
  'concurrencyConflict',
  'forbiddenAction',
  'invalidStateTransition',
  'idempotencyRetry',
  'externalIntegrationFailure',
]
const C_KEYS = ['rbacTenancyProven', 'auditVisible', 'logsMetricsEvidence']

function readJson(name) {
  const file = path.join(DATA_DIR, name)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function mdCell(value) {
  if (value == null) return ''
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function table(headers, rows) {
  const head = `| ${headers.map(mdCell).join(' | ')} |`
  const sep = `|${headers.map(() => '---').join('|')}|`
  const body = rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function roundInt(value) {
  return Math.round(value)
}

function verdictForScenario(status, matrixBEntry) {
  const allLinked = matrixBEntry.acLinked && matrixBEntry.testsLinked && matrixBEntry.evidenceLinked
  if (!allLinked) {
    if (status === 0) return 'Missing'
    return 'Partial'
  }
  if (status === 100) return 'Covered'
  if (status === 0) return 'Missing'
  return 'Partial'
}

function boolToYesNo(value) {
  return value ? 'Y' : 'N'
}

function main() {
  const milestones = readJson('milestones.json')
  const scenarios = readJson('scenario-register.json')
  const matrixA = readJson('traceability-matrix-a.json')
  const matrixB = readJson('traceability-matrix-b.json')
  const scorecards = readJson('milestone-scorecards.json')

  const errors = []
  const warnings = []

  const milestonesById = new Map(milestones.map((m) => [m.id, m]))
  const scenariosById = new Map()

  for (const milestone of milestones) {
    if (!Number.isInteger(milestone.id) || milestone.id < 1 || milestone.id > 24) {
      errors.push(`Invalid milestone id: ${JSON.stringify(milestone)}`)
    }
    if (!milestone.name || typeof milestone.name !== 'string') {
      errors.push(`Milestone ${milestone.id} missing canonical name.`)
    }
  }

  for (const scenario of scenarios) {
    if (!scenario.scenarioId || typeof scenario.scenarioId !== 'string') {
      errors.push(`Scenario missing scenarioId: ${JSON.stringify(scenario)}`)
      continue
    }
    if (scenariosById.has(scenario.scenarioId)) {
      errors.push(`Duplicate scenarioId: ${scenario.scenarioId}`)
      continue
    }
    scenariosById.set(scenario.scenarioId, scenario)

    if (!milestonesById.has(scenario.ownerMilestone)) {
      errors.push(`Scenario ${scenario.scenarioId} owner milestone ${scenario.ownerMilestone} is invalid.`)
    }
    if (!Array.isArray(scenario.dependencies)) {
      errors.push(`Scenario ${scenario.scenarioId} dependencies must be array.`)
    } else {
      for (const dep of scenario.dependencies) {
        if (!milestonesById.has(dep)) {
          errors.push(`Scenario ${scenario.scenarioId} dependency milestone ${dep} is invalid.`)
        }
      }
    }
    if (!ALLOWED_SCENARIO_STATUS.has(scenario.status)) {
      errors.push(`Scenario ${scenario.scenarioId} has invalid status ${scenario.status}.`)
    }
    if (!Array.isArray(scenario.testIds) || scenario.testIds.length === 0) {
      warnings.push(`Scenario ${scenario.scenarioId} has no linked tests.`)
    }
    if (!Array.isArray(scenario.evidenceLinks) || scenario.evidenceLinks.length === 0) {
      warnings.push(`Scenario ${scenario.scenarioId} has no evidence links.`)
    }
  }

  const matrixAByScenario = new Map()
  for (const row of matrixA) {
    if (matrixAByScenario.has(row.scenarioId)) {
      errors.push(`Traceability Matrix A duplicate scenarioId ${row.scenarioId}`)
      continue
    }
    matrixAByScenario.set(row.scenarioId, row)
    const scenario = scenariosById.get(row.scenarioId)
    if (!scenario) {
      errors.push(`Traceability Matrix A references unknown scenario ${row.scenarioId}`)
      continue
    }
    if (scenario.ownerMilestone !== row.ownerMilestone) {
      errors.push(
        `Traceability Matrix A owner mismatch for ${row.scenarioId}: register=${scenario.ownerMilestone} matrixA=${row.ownerMilestone}`,
      )
    }
  }

  const matrixBByScenario = new Map()
  for (const row of matrixB) {
    if (matrixBByScenario.has(row.scenarioId)) {
      errors.push(`Traceability Matrix B duplicate scenarioId ${row.scenarioId}`)
      continue
    }
    matrixBByScenario.set(row.scenarioId, row)
    const scenario = scenariosById.get(row.scenarioId)
    if (!scenario) {
      errors.push(`Traceability Matrix B references unknown scenario ${row.scenarioId}`)
      continue
    }
    const expectedVerdict = verdictForScenario(scenario.status, row)
    if (expectedVerdict !== row.coverageVerdict) {
      errors.push(
        `Traceability Matrix B verdict mismatch for ${row.scenarioId}: expected ${expectedVerdict}, got ${row.coverageVerdict}`,
      )
    }
  }

  for (const scenario of scenarios) {
    if (!matrixAByScenario.has(scenario.scenarioId)) {
      errors.push(`Scenario ${scenario.scenarioId} missing from Traceability Matrix A`)
    }
    if (!matrixBByScenario.has(scenario.scenarioId)) {
      errors.push(`Scenario ${scenario.scenarioId} missing from Traceability Matrix B`)
    }
  }

  const ownedByMilestone = new Map()
  for (const scenario of scenarios) {
    const list = ownedByMilestone.get(scenario.ownerMilestone) ?? []
    list.push(scenario)
    ownedByMilestone.set(scenario.ownerMilestone, list)
  }

  const evidenceRows = milestones.map((milestone) => {
    const owned = ownedByMilestone.get(milestone.id) ?? []
    const coveredOwned = owned.filter((s) => s.status === 100).length
    const totalOwned = owned.length
    const aPoints = totalOwned > 0 ? (coveredOwned / totalOwned) * 50 : 0

    const scorecard = scorecards[String(milestone.id)] ?? {}
    const checklist = scorecard.policyFailureChecklist ?? {}
    const checklistTrueCount = CHECKLIST_KEYS.filter((key) => checklist[key] === true).length
    const bPoints = (checklistTrueCount / CHECKLIST_KEYS.length) * 20

    const c = scorecard.securityAuditObservability ?? {}
    const cPoints =
      (c.rbacTenancyProven === true ? 5 : 0) +
      (c.auditVisible === true ? 5 : 0) +
      (c.logsMetricsEvidence === true ? 5 : 0)

    const d = scorecard.testsReleaseSignals ?? {}
    const dPoints = (d.testsEvidence === true ? 10 : 0) + (d.ciOrStagingEvidence === true ? 5 : 0)

    const evidencePercent = roundInt(aPoints + bPoints + cPoints + dPoints)
    const delta = evidencePercent - milestone.codexPercent

    return {
      milestoneId: milestone.id,
      milestoneName: milestone.name,
      codexPercent: milestone.codexPercent,
      evidencePercent,
      delta,
      ownedScenarios: totalOwned,
      coveredOwned,
      scores: {
        A: round1(aPoints),
        B: round1(bPoints),
        C: round1(cPoints),
        D: round1(dPoints),
      },
      flags: {
        hasOwnedScenarios: totalOwned > 0,
      },
    }
  })

  const scenariosMissingOwner = scenarios.filter((s) => !s.ownerMilestone)
  if (scenariosMissingOwner.length > 0) {
    errors.push(`Found scenarios without owner milestone: ${scenariosMissingOwner.map((s) => s.scenarioId).join(', ')}`)
  }

  const orphanMilestones = milestones.filter((m) => (ownedByMilestone.get(m.id) ?? []).length === 0)
  if (orphanMilestones.length > 0) {
    warnings.push(
      `Milestones with zero owned scenarios in current register: ${orphanMilestones.map((m) => `#${m.id}`).join(', ')}`,
    )
  }

  const scenarioRegisterMd = [
    '# Scenario Register',
    '',
    'Single Source of Truth for PRD-00 scenario coverage.',
    '',
    table(
      [
        'Scenario ID',
        'Scenario name',
        'Outcome',
        'Owner milestone',
        'Dependencies',
        'MVP scope',
        'Status (0/50/100)',
        'PRD links',
        'Test IDs',
        'Evidence link',
        'Gap note',
        'Backlog link',
      ],
      scenarios.map((s) => [
        s.scenarioId,
        s.scenarioName,
        s.outcome,
        `#${s.ownerMilestone} ${milestonesById.get(s.ownerMilestone)?.name ?? ''}`,
        (s.dependencies ?? []).map((id) => `#${id}`).join(', '),
        s.mvpScope ? 'Y' : 'N',
        s.status,
        (s.prdLinks ?? []).join('; '),
        (s.testIds ?? []).join('; '),
        (s.evidenceLinks ?? []).join('; '),
        s.gapNote || '',
        s.backlogLink || '',
      ]),
    ),
    '',
  ].join('\n')

  const matrixAMd = [
    '# Traceability Matrix A (Scenario -> PRD Ownership)',
    '',
    table(
      [
        'Scenario ID',
        'Owner milestone',
        'Dependency milestones',
        'Owner PRD contains Scenario Pack? (Y/N)',
        'Notes',
      ],
      matrixA.map((row) => [
        row.scenarioId,
        `#${row.ownerMilestone} ${milestonesById.get(row.ownerMilestone)?.name ?? ''}`,
        (row.dependencyMilestones ?? []).map((id) => `#${id}`).join(', '),
        boolToYesNo(row.ownerPrdContainsScenarioPack),
        row.notes || '',
      ]),
    ),
    '',
  ].join('\n')

  const matrixBMd = [
    '# Traceability Matrix B (Scenario -> AC -> Tests -> Evidence)',
    '',
    table(
      ['Scenario ID', 'AC linked?', 'Tests linked?', 'Evidence linked?', 'Coverage verdict'],
      matrixB.map((row) => [
        row.scenarioId,
        row.acLinked ? 'Yes' : 'No',
        row.testsLinked ? 'Yes' : 'No',
        row.evidenceLinked ? 'Yes' : 'No',
        row.coverageVerdict,
      ]),
    ),
    '',
    'Coverage verdict rule: if any of AC / Tests / Evidence is missing -> `Partial` (or `Missing` if the flow fails).',
    '',
  ].join('\n')

  const readinessMd = [
    '# Evidence-Based Readiness Report (PRD-00)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Validation Summary',
    '',
    `- Scenarios: ${scenarios.length}`,
    `- Matrix A rows: ${matrixA.length}`,
    `- Matrix B rows: ${matrixB.length}`,
    `- Errors: ${errors.length}`,
    `- Warnings: ${warnings.length}`,
    '',
    ...(warnings.length > 0 ? ['### Warnings', '', ...warnings.map((w) => `- ${w}`), ''] : []),
    '## Milestone Evidence Breakdown',
    '',
    table(
      ['Milestone', 'Owned', 'Covered', 'A (50)', 'B (20)', 'C (15)', 'D (15)', 'Evidence %'],
      evidenceRows.map((row) => [
        `#${row.milestoneId} ${row.milestoneName}`,
        row.ownedScenarios,
        row.coveredOwned,
        row.scores.A,
        row.scores.B,
        row.scores.C,
        row.scores.D,
        row.evidencePercent,
      ]),
    ),
    '',
    '## Codex % Cross-check Table',
    '',
    table(
      ['Milestone', 'Codex %', 'Evidence %', 'Delta', 'Why (facts)', 'Action'],
      evidenceRows.map((row) => {
        const reasons = []
        if (!row.flags.hasOwnedScenarios) reasons.push('No owned scenarios registered yet')
        if (row.ownedScenarios > 0 && row.coveredOwned < row.ownedScenarios) {
          reasons.push(`${row.coveredOwned}/${row.ownedScenarios} owned scenarios are fully covered`)
        }
        if (row.scores.C < 15) reasons.push('Security/audit/observability evidence incomplete')
        if (row.scores.D < 15) reasons.push('Tests/CI/staging evidence incomplete')
        const why = reasons.join('; ') || 'Evidence aligns with current registered coverage'

        let action = 'Maintain and refresh evidence'
        if (!row.flags.hasOwnedScenarios) action = 'Register owned scenarios + Scenario Pack'
        else if (row.coveredOwned < row.ownedScenarios) action = 'Close scenario gaps and attach proof'
        else if (row.scores.C < 15 || row.scores.D < 15) action = 'Add non-functional evidence and signals'

        return [
          `#${row.milestoneId} ${row.milestoneName}`,
          row.codexPercent,
          row.evidencePercent,
          row.delta >= 0 ? `+${row.delta}` : String(row.delta),
          why,
          action,
        ]
      }),
    ),
    '',
  ].join('\n')

  if (WRITE) {
    ensureDir(OUT_DIR)
    fs.writeFileSync(path.join(OUT_DIR, 'scenario-register.md'), scenarioRegisterMd)
    fs.writeFileSync(path.join(OUT_DIR, 'traceability-matrix-a.md'), matrixAMd)
    fs.writeFileSync(path.join(OUT_DIR, 'traceability-matrix-b.md'), matrixBMd)
    fs.writeFileSync(path.join(OUT_DIR, 'evidence-readiness-report.md'), readinessMd)
  }

  if (errors.length > 0) {
    console.error('PRD-00 governance validation failed:')
    for (const error of errors) console.error(`- ${error}`)
    if (warnings.length > 0) {
      console.error('Warnings:')
      for (const warning of warnings) console.error(`- ${warning}`)
    }
    process.exit(1)
  }

  console.log(`PRD-00 governance validation passed. scenarios=${scenarios.length} warnings=${warnings.length}`)
  if (!WRITE) return
  console.log(`Generated artifacts in ${path.relative(ROOT, OUT_DIR)}`)
}

main()

