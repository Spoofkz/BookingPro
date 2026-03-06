import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.SCHEDULE_V3_TEST_PORT || 3116)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 180) serverLog.splice(0, serverLog.length - 180)
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

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) headers.set('cookie', cookie)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  storeSetCookies(response)

  const text = await response.text()
  const json = parseJsonSafely(text)
  return {
    status: response.status,
    ok: response.ok,
    text,
    json,
    headers: {
      idempotentReplay: response.headers.get('x-idempotent-replay'),
    },
  }
}

async function waitForServerReady() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEV_SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/api/me`, { redirect: 'manual' })
      if (response.status !== 500 && response.status !== 503) return
    } catch {
      // keep waiting
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

test.before(async () => {
  devServer = spawn('./node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))
  await waitForServerReady()

  await setContext({ userEmail: 'tech@example.com' })
  const clubs = await api('/api/clubs')
  assert.equal(clubs.status, 200, `Expected /api/clubs 200, got ${clubs.status}: ${clubs.text}`)
  hostClubId = clubs.json?.activeClubId || clubs.json?.items?.[0]?.id || ''
  assert.ok(hostClubId, 'Expected active club id from /api/clubs')
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
})

test('schedule v3 template + plan generation uses idempotency and exposes diff/conflicts', async () => {
  await setContext({ userEmail: 'tech@example.com' })

  const template = await api('/api/schedule/templates', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      name: 'Advanced Ops Template',
      defaultHorizonDays: 7,
      slotDurationMinutes: 60,
      slotStepMinutes: 30,
      breakBufferMinutes: 0,
      bookingLeadTimeMinutes: 30,
      maxAdvanceDays: 60,
      weeklyHours: {
        sunday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        monday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        tuesday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        wednesday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        thursday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        friday: { closed: false, openTime: '10:00', closeTime: '23:00' },
        saturday: { closed: false, openTime: '10:00', closeTime: '23:00' },
      },
    }),
  })
  assert.ok(
    template.status === 200 || template.status === 201,
    `Expected template save 200/201, got ${template.status}: ${template.text}`,
  )

  const generatePayload = {
    clubId: hostClubId,
    horizonDays: 3,
    options: {
      touchWindowMinutes: 240,
      bookedSlotsPolicy: 'FREEZE',
      publishMode: 'SAFE',
    },
  }
  const idempotencyKey = `schedule-v3-generate-${Date.now()}`
  const generated = await api('/api/schedule/plans/generate', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(generatePayload),
  })
  assert.equal(generated.status, 201, `Expected generate 201, got ${generated.status}: ${generated.text}`)
  const planId = generated.json?.planId
  assert.ok(planId, `Expected planId in generate response: ${generated.text}`)

  const replay = await api('/api/schedule/plans/generate', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(generatePayload),
  })
  assert.equal(replay.status, 201, `Expected replay 201, got ${replay.status}: ${replay.text}`)
  assert.equal(replay.json?.planId, planId, 'Expected same planId on idempotent replay')
  assert.equal(replay.headers.idempotentReplay, 'true', 'Expected idempotent replay header')

  const bodyOnlyGenerate = await api('/api/schedule/plans/generate', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      horizonDays: 2,
      idempotencyKey: `schedule-v3-body-key-${Date.now()}`,
    }),
  })
  assert.equal(
    bodyOnlyGenerate.status,
    201,
    `Expected body idempotency generate 201, got ${bodyOnlyGenerate.status}: ${bodyOnlyGenerate.text}`,
  )
  assert.ok(bodyOnlyGenerate.json?.planId, 'Expected planId for body-idempotency generate')

  const diff = await api(`/api/schedule/plans/${encodeURIComponent(planId)}/diff?clubId=${encodeURIComponent(hostClubId)}`)
  assert.equal(diff.status, 200, `Expected diff 200, got ${diff.status}: ${diff.text}`)
  assert.equal(diff.json?.planId, planId, 'Diff endpoint should return the same plan id')

  const conflicts = await api(
    `/api/schedule/plans/${encodeURIComponent(planId)}/conflicts?clubId=${encodeURIComponent(hostClubId)}`,
  )
  assert.equal(conflicts.status, 200, `Expected conflicts 200, got ${conflicts.status}: ${conflicts.text}`)
  assert.ok(Array.isArray(conflicts.json?.conflicts), 'Expected conflicts array')
})

test('schedule v3 exceptions provide impact preview and plan publish is idempotent', async () => {
  await setContext({ userEmail: 'tech@example.com' })

  const existingExceptions = await api(`/api/schedule/exceptions?clubId=${encodeURIComponent(hostClubId)}`)
  assert.equal(
    existingExceptions.status,
    200,
    `Expected exceptions list 200, got ${existingExceptions.status}: ${existingExceptions.text}`,
  )
  for (const item of existingExceptions.json?.items || []) {
    if (item?.reason !== 'Tournament reservation') continue
    const cleanup = await api(
      `/api/schedule/exceptions/${encodeURIComponent(item.id)}?clubId=${encodeURIComponent(hostClubId)}`,
      { method: 'DELETE' },
    )
    assert.ok(
      cleanup.status === 200 || cleanup.status === 404,
      `Expected cleanup delete 200/404, got ${cleanup.status}: ${cleanup.text}`,
    )
  }

  const now = Date.now()
  const startAt = new Date(now + 2 * 24 * 60 * 60 * 1000)
  startAt.setUTCHours(12, 0, 0, 0)
  const endAt = new Date(startAt.getTime() + 3 * 60 * 60 * 1000)

  const exception = await api('/api/schedule/exceptions', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostClubId,
      title: 'Tournament Block',
      type: 'BLOCKED_RANGE',
      scopeType: 'CLUB',
      behavior: 'BLOCK_PUBLIC',
      isEvent: true,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reason: 'Tournament reservation',
    }),
  })
  assert.equal(exception.status, 201, `Expected exception create 201, got ${exception.status}: ${exception.text}`)
  assert.ok(
    typeof exception.json?.impactPreview?.impactedSlots === 'number',
    'Expected impactedSlots in impactPreview',
  )

  const generated = await api('/api/schedule/plans/generate', {
    method: 'POST',
    headers: { 'idempotency-key': `schedule-v3-generate-2-${Date.now()}` },
    body: JSON.stringify({ clubId: hostClubId, horizonDays: 3 }),
  })
  assert.equal(generated.status, 201, `Expected generate 201, got ${generated.status}: ${generated.text}`)
  const planId = generated.json?.planId
  assert.ok(planId, `Expected planId in generate response: ${generated.text}`)

  const publishKey = `schedule-v3-publish-${Date.now()}`
  const forceNoReason = await api(`/api/schedule/plans/${encodeURIComponent(planId)}/publish`, {
    method: 'POST',
    headers: { 'idempotency-key': `schedule-v3-force-${Date.now()}` },
    body: JSON.stringify({ clubId: hostClubId, publishMode: 'FORCE' }),
  })
  assert.equal(
    forceNoReason.status,
    400,
    `Expected force publish without reason 400, got ${forceNoReason.status}: ${forceNoReason.text}`,
  )

  const published = await api(`/api/schedule/plans/${encodeURIComponent(planId)}/publish`, {
    method: 'POST',
    headers: { 'idempotency-key': publishKey },
    body: JSON.stringify({ clubId: hostClubId, publishMode: 'SAFE' }),
  })
  assert.equal(published.status, 200, `Expected publish 200, got ${published.status}: ${published.text}`)
  assert.ok(
    typeof published.json?.result?.created === 'number',
    `Expected publish result counters: ${published.text}`,
  )

  const publishReplay = await api(`/api/schedule/plans/${encodeURIComponent(planId)}/publish`, {
    method: 'POST',
    headers: { 'idempotency-key': publishKey },
    body: JSON.stringify({ clubId: hostClubId, publishMode: 'SAFE' }),
  })
  assert.equal(publishReplay.status, 200, `Expected replay publish 200, got ${publishReplay.status}: ${publishReplay.text}`)
  assert.equal(publishReplay.headers.idempotentReplay, 'true', 'Expected idempotent replay header on publish')

  const from = generated.json?.rangeStartUtc
  const to = generated.json?.rangeEndUtc
  assert.ok(from && to, 'Expected rangeStartUtc/rangeEndUtc in generated plan response')
  const slots = await api(
    `/api/clubs/${encodeURIComponent(hostClubId)}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
  assert.equal(slots.status, 200, `Expected slots 200, got ${slots.status}: ${slots.text}`)
  const keys = new Set((slots.json?.items || []).map((item) => `${item.startAt}|${item.endAt}`))
  assert.equal(
    keys.size,
    (slots.json?.items || []).length,
    'Slot publish should not create duplicate slot intervals',
  )
})

test('host can create limited-scope exceptions and cannot use restricted scopes', async () => {
  await setContext({ userEmail: 'host@example.com' })
  const clubs = await api('/api/clubs')
  assert.equal(clubs.status, 200, `Expected /api/clubs 200 for host, got ${clubs.status}: ${clubs.text}`)
  const hostActiveClubId = clubs.json?.activeClubId || clubs.json?.items?.[0]?.id || ''
  assert.ok(hostActiveClubId, 'Expected host active club id')

  const now = Date.now()
  const startAt = new Date(now + 5 * 24 * 60 * 60 * 1000)
  startAt.setUTCHours(7, 0, 0, 0)
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000)

  const allowed = await api('/api/schedule/exceptions', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostActiveClubId,
      type: 'SPECIAL_HOURS',
      scopeType: 'CLUB',
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      reason: 'Host early opening',
    }),
  })
  assert.equal(
    allowed.status,
    201,
    `Expected host CLUB-scope exception 201, got ${allowed.status}: ${allowed.text}`,
  )

  const denied = await api('/api/schedule/exceptions', {
    method: 'POST',
    body: JSON.stringify({
      clubId: hostActiveClubId,
      type: 'BLOCKED_RANGE',
      scopeType: 'FLOOR',
      startAt: new Date(startAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      endAt: new Date(startAt.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      reason: 'Host floor closure attempt',
    }),
  })
  assert.equal(
    denied.status,
    403,
    `Expected host restricted-scope exception 403, got ${denied.status}: ${denied.text}`,
  )
})
