import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.PRD00_TEST_PORT || 3111)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

const tempRoot = path.join('/tmp', `booking-prd00-${Date.now()}`)
const tempDataDir = path.join(tempRoot, 'data')

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 200) serverLog.splice(0, serverLog.length - 200)
}

function parseJsonSafely(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function storeSetCookies(response) {
  const getSetCookie = response.headers.getSetCookie
  const lines = typeof getSetCookie === 'function' ? getSetCookie.call(response.headers) : []
  for (const line of lines) {
    const firstPart = line.split(';', 1)[0] || ''
    const eqIndex = firstPart.indexOf('=')
    if (eqIndex <= 0) continue
    const key = firstPart.slice(0, eqIndex).trim()
    const value = firstPart.slice(eqIndex + 1)
    if (!key) continue
    if (!value) cookies.delete(key)
    else cookies.set(key, value)
  }
}

function cookieHeaderValue() {
  return Array.from(cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

async function api(urlPath, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) headers.set('cookie', cookie)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${BASE_URL}${urlPath}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  storeSetCookies(response)
  const text = await response.text()
  return { status: response.status, ok: response.ok, text, json: parseJsonSafely(text) }
}

async function waitForServerReady() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEV_SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/api/me`, { redirect: 'manual' })
      if (response.status !== 500 && response.status !== 503) return
    } catch {
      // retry
    }
    await delay(500)
  }
  throw new Error(`Dev server did not start.\n${serverLog.slice(-40).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 200, `Expected /api/context 200, got ${response.status}: ${response.text}`)
}

function copyGovernanceFixtures() {
  fs.mkdirSync(tempDataDir, { recursive: true })
  const sourceDataDir = path.join(process.cwd(), 'docs', 'scenario-governance', 'data')
  for (const file of fs.readdirSync(sourceDataDir)) {
    const from = path.join(sourceDataDir, file)
    const to = path.join(tempDataDir, file)
    fs.copyFileSync(from, to)
  }
}

test.before(async () => {
  copyGovernanceFixtures()

  devServer = spawn('./node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      SCENARIO_GOV_DATA_DIR: tempDataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))

  await waitForServerReady()
})

test.after(async () => {
  if (devServer && !devServer.killed) {
    const proc = devServer
    proc.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => proc.once('exit', resolve)),
      delay(5000),
    ])
    if (!proc.killed) proc.kill('SIGKILL')
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('scenario APIs are protected by platform roles', async () => {
  await setContext({ userEmail: 'host@example.com' })
  const denied = await api('/api/scenarios')
  assert.equal(denied.status, 403, `Expected 403, got ${denied.status}: ${denied.text}`)

  await setContext({ userEmail: 'tech@example.com' })
  const allowed = await api('/api/scenarios')
  assert.equal(allowed.status, 200, `Expected 200, got ${allowed.status}: ${allowed.text}`)
  assert.ok(Array.isArray(allowed.json?.items), 'Expected items array in /api/scenarios response')
})

test('scenario create -> link -> verify -> cover -> readiness recompute', async () => {
  await setContext({ userEmail: 'tech@example.com' })
  const scenarioId = `PRD00-T-${Date.now()}`

  const created = await api('/api/scenarios', {
    method: 'POST',
    body: JSON.stringify({
      scenarioId,
      name: 'PRD-00 test scenario',
      outcome: 'Evidence-driven coverage path is proven.',
      ownerMilestone: 24,
      dependencies: [17, 23],
      mvpScope: true,
      status: 50,
      nfrTags: ['audit', 'release'],
      gapNote: 'Created by automated test',
    }),
  })
  assert.equal(created.status, 201, `Expected create 201, got ${created.status}: ${created.text}`)

  const linkTypes = ['PRD', 'AC', 'TEST', 'EVIDENCE']
  for (const linkType of linkTypes) {
    const linked = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/links`, {
      method: 'POST',
      body: JSON.stringify({
        linkType,
        title: `${linkType} link`,
        url: `test://${scenarioId}/${linkType.toLowerCase()}`,
      }),
    })
    assert.equal(linked.status, 201, `Expected link ${linkType} 201, got ${linked.status}: ${linked.text}`)
  }

  const verify = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({
      environment: 'staging',
      verdict: 'Covered',
      negativeCaseRecorded: true,
      artifactUrl: `artifact://${scenarioId}`,
      notes: 'Negative case executed',
    }),
  })
  assert.equal(verify.status, 201, `Expected verify 201, got ${verify.status}: ${verify.text}`)

  const covered = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 100 }),
  })
  assert.equal(covered.status, 200, `Expected patch 200, got ${covered.status}: ${covered.text}`)
  assert.equal(covered.json?.status, 100, 'Scenario should be marked covered')

  const detail = await api(`/api/scenarios/${encodeURIComponent(scenarioId)}`)
  assert.equal(detail.status, 200, `Expected detail 200, got ${detail.status}: ${detail.text}`)
  assert.equal(detail.json?.completeness?.coverageVerdict, 'Covered', 'Completeness should be Covered')

  const recompute = await api('/api/milestones/readiness/recompute', { method: 'POST' })
  assert.equal(recompute.status, 200, `Expected recompute 200, got ${recompute.status}: ${recompute.text}`)
  assert.ok(Array.isArray(recompute.json?.items), 'Expected readiness snapshot items')

  const readiness = await api('/api/milestones/readiness')
  assert.equal(readiness.status, 200, `Expected readiness 200, got ${readiness.status}: ${readiness.text}`)
  const milestone24 = (readiness.json?.items || []).find((item) => item.milestoneId === 24)
  assert.ok(milestone24, 'Expected milestone 24 readiness snapshot')
})
