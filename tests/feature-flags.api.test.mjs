import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.FEATURE_FLAG_TEST_PORT || 3108)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()
let activeClubId = ''

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
    const idx = firstPart.indexOf('=')
    if (idx <= 0) continue
    const key = firstPart.slice(0, idx).trim()
    const value = firstPart.slice(idx + 1)
    if (!key) continue
    if (!value) cookies.delete(key)
    else cookies.set(key, value)
  }
}

function cookieHeaderValue() {
  return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
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
    response = await fetch(`${BASE_URL}${urlPath}`, { ...init, headers, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }

  storeSetCookies(response)
  const text = await response.text()
  return { status: response.status, text, json: parseJsonSafely(text) }
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

async function switchContext(userEmail) {
  await setContext({ userEmail })
}

function isoAfterHours(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

test.before(async () => {
  devServer = spawn('./node_modules/.bin/next', ['dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      RELEASE_DISABLE_HOLDS: 'true',
      RELEASE_DISABLE_PROMOS: 'true',
      RELEASE_DISABLE_RESCHEDULE: 'true',
      RELEASE_DISABLE_MEMBERSHIP_APPLY: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))
  await waitForServerReady()
  await switchContext('client@example.com')
  const me = await api('/api/me')
  assert.equal(me.status, 200, `me failed: ${me.status}: ${me.text}`)
  activeClubId = me.json?.activeClubId || me.json?.defaultClubId || ''
  assert.ok(activeClubId, 'Expected active club id.')
})

test.after(async () => {
  if (devServer && !devServer.killed) {
    devServer.kill('SIGTERM')
    await delay(1000)
    if (!devServer.killed) devServer.kill('SIGKILL')
  }
})

test('kill switch blocks hold creation', async () => {
  const response = await api('/api/clubs/flag-test-club/holds', {
    method: 'POST',
    headers: { 'X-Club-Id': 'flag-test-club' },
    body: JSON.stringify({ slotId: 'sl1', seatId: 'seat1' }),
  })
  assert.equal(response.status, 409)
  assert.equal(response.json?.code, 'HOLDS_DISABLED')
})

test('kill switch blocks promo code application in quote path', async () => {
  const response = await api('/api/pricing/quote', {
    method: 'POST',
    body: JSON.stringify({ clubId: activeClubId, promoCode: 'WELCOME10' }),
  })
  assert.equal(response.status, 409)
  assert.equal(response.json?.code, 'PROMOS_DISABLED')
})

test('kill switch blocks membership application in booking path', async () => {
  const response = await api('/api/bookings', {
    method: 'POST',
    body: JSON.stringify({
      roomId: 1,
      guestName: 'Kill Switch Test',
      guestEmail: 'flag@example.com',
      checkIn: isoAfterHours(24),
      checkOut: isoAfterHours(26),
      guests: 1,
      membership: { useWallet: true },
    }),
  })
  assert.equal(response.status, 409)
  assert.equal(response.json?.code, 'MEMBERSHIP_APPLY_DISABLED')
})

test('kill switch blocks reschedule intent creation', async () => {
  const response = await api('/api/bookings/1/reschedule/intents', {
    method: 'POST',
    body: JSON.stringify({ newSlotId: 'sl_new' }),
  })
  assert.equal(response.status, 409)
  assert.equal(response.json?.code, 'RESCHEDULE_DISABLED')
})
