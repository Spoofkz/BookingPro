import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.CLIENT_PERSONA_TEST_PORT || 3113)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 200) {
    serverLog.splice(0, serverLog.length - 200)
  }
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
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

async function api(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const cookie = cookieHeaderValue()
  if (cookie) headers.set('cookie', cookie)
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json')
  }

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
  return { status: response.status, ok: response.ok, text, json }
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
  throw new Error(`Dev server did not start.\n${serverLog.slice(-60).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(response.status, 200, `Expected /api/context 200, got ${response.status}: ${response.text}`)
  return response.json
}

test.before(async () => {
  devServer = spawn(
    'npm',
    ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ALLOW_DEMO_AUTH: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  devServer.stdout.on('data', (chunk) => rememberLog('[dev] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[dev:err] ', chunk))
  await waitForServerReady()
  await setContext({ userEmail: 'host@example.com' })
})

test.after(async () => {
  if (devServer) {
    devServer.kill('SIGTERM')
    await delay(500)
  }
})

test('persona mode defaults to staff for staff users and can switch to client', async () => {
  const initial = await api('/api/me/context')
  assert.equal(initial.status, 200, `Expected /api/me/context 200, got ${initial.status}: ${initial.text}`)
  assert.equal(initial.json?.defaultMode, 'STAFF', `Expected default staff mode: ${initial.text}`)
  assert.equal(initial.json?.activeMode, 'STAFF', `Expected active staff mode: ${initial.text}`)
  assert.ok(
    Number(initial.json?.staffMembershipsCount || 0) > 0,
    `Expected staff memberships count > 0: ${initial.text}`,
  )

  const toClient = await api('/api/me/mode', {
    method: 'POST',
    body: JSON.stringify({ activeMode: 'CLIENT' }),
  })
  assert.equal(toClient.status, 200, `Expected mode switch to client 200, got ${toClient.status}: ${toClient.text}`)
  assert.equal(toClient.json?.activeMode, 'CLIENT', `Expected activeMode CLIENT: ${toClient.text}`)

  const afterClient = await api('/api/me/context')
  assert.equal(afterClient.status, 200, `Expected context 200 after switch, got ${afterClient.status}: ${afterClient.text}`)
  assert.equal(afterClient.json?.activeMode, 'CLIENT', `Expected persisted CLIENT mode: ${afterClient.text}`)

  const toStaff = await api('/api/me/mode', {
    method: 'POST',
    body: JSON.stringify({ activeMode: 'STAFF' }),
  })
  assert.equal(toStaff.status, 200, `Expected mode switch to staff 200, got ${toStaff.status}: ${toStaff.text}`)
  assert.equal(toStaff.json?.activeMode, 'STAFF', `Expected activeMode STAFF: ${toStaff.text}`)
})
