import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const PORT = Number(process.env.CRM_TEST_PORT || 3101)
const BASE_URL = `http://127.0.0.1:${PORT}`
const DEV_SERVER_START_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 20_000

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let devServer = null
const serverLog = []
const cookies = new Map()

let hostClubId = ''
let bookingId = 0

function rememberLog(prefix, chunk) {
  const line = `${prefix}${String(chunk).trim()}`
  if (!line) return
  serverLog.push(line)
  if (serverLog.length > 120) {
    serverLog.splice(0, serverLog.length - 120)
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
  const lines =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : []

  for (const line of lines) {
    const firstPart = line.split(';', 1)[0] || ''
    const eqIndex = firstPart.indexOf('=')
    if (eqIndex <= 0) continue
    const key = firstPart.slice(0, eqIndex).trim()
    const value = firstPart.slice(eqIndex + 1)
    if (!key) continue
    if (!value) {
      cookies.delete(key)
    } else {
      cookies.set(key, value)
    }
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
  if (cookie) {
    headers.set('cookie', cookie)
  }
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
  return {
    status: response.status,
    ok: response.ok,
    text,
    json,
  }
}

async function waitForServerReady() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < DEV_SERVER_START_TIMEOUT_MS) {
    try {
      const response = await fetch(`${BASE_URL}/api/me`, { redirect: 'manual' })
      if (response.status !== 500 && response.status !== 503) {
        return
      }
    } catch {
      // Ignore until server boots.
    }
    await delay(500)
  }
  throw new Error(`Dev server did not start.\n${serverLog.slice(-30).join('\n')}`)
}

async function setContext(payload) {
  const response = await api('/api/context', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  assert.equal(
    response.status,
    200,
    `Expected /api/context 200, got ${response.status}: ${response.text}`,
  )
  return response.json
}

async function requireActiveClub() {
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  assert.ok(me.json?.activeClubId, `Expected activeClubId in /api/me response: ${me.text}`)
  return me.json.activeClubId
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  devServer.stdout.on('data', (chunk) => rememberLog('[next:stdout] ', chunk))
  devServer.stderr.on('data', (chunk) => rememberLog('[next:stderr] ', chunk))

  await waitForServerReady()

  await setContext({ userEmail: 'host@example.com' })
  hostClubId = await requireActiveClub()
  await setContext({ clubId: hostClubId, role: 'HOST_ADMIN' })
})

test.after(async () => {
  if (!devServer || devServer.killed) return
  const proc = devServer
  proc.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => proc.once('exit', resolve)),
    delay(5000),
  ])
  if (!proc.killed) {
    proc.kill('SIGKILL')
  }
})

test('client cannot access customer endpoints', async () => {
  await setContext({ userEmail: 'client@example.com' })
  await setContext({ clubId: hostClubId, role: 'CLIENT' })

  const response = await api('/api/customers?q=test', {
    headers: {
      'X-Club-Id': hostClubId,
    },
  })
  assert.equal(response.status, 403, `Expected 403, got ${response.status}: ${response.text}`)
  assert.equal(response.json?.code, 'INSUFFICIENT_PERMISSION')

  await setContext({ userEmail: 'host@example.com' })
  await setContext({ clubId: hostClubId, role: 'HOST_ADMIN' })
})

test('walk-in booking auto-creates customer and search can find by last 4 phone digits', async () => {
  const roomsResponse = await api('/api/rooms', {
    headers: {
      'X-Club-Id': hostClubId,
    },
  })
  assert.equal(roomsResponse.status, 200, `Expected rooms 200, got ${roomsResponse.status}: ${roomsResponse.text}`)
  assert.ok(Array.isArray(roomsResponse.json) && roomsResponse.json.length > 0, 'Expected seeded rooms')

  const unique = `${Date.now()}`
  const phone = `+7701${unique.slice(-7)}`
  const candidateOffsets = [96, 120, 144, 168, 192, 216]
  let bookingResponse = null
  for (const room of roomsResponse.json) {
    const roomId = room?.id
    if (!Number.isInteger(roomId)) continue
    for (const startOffset of candidateOffsets) {
      const attempt = await api('/api/bookings', {
        method: 'POST',
        headers: {
          'X-Club-Id': hostClubId,
        },
        body: JSON.stringify({
          roomId,
          guestName: `CRM Test ${unique}`,
          guestEmail: `crm-${unique}@example.com`,
          guestPhone: phone,
          checkIn: isoAfterHours(startOffset),
          checkOut: isoAfterHours(startOffset + 2),
          guests: 1,
          notes: 'crm-auto-link-test',
        }),
      })

      if (attempt.status === 201) {
        bookingResponse = attempt
        break
      }
      const errorText = String(attempt.json?.error || '')
      const roomConflict = attempt.status === 409 && errorText.includes('already booked')
      const missingSegment = errorText.includes('Segment is required for price quote.')
      if (roomConflict || missingSegment) {
        continue
      }
      assert.fail(`Booking creation failed for room ${roomId}: ${attempt.status} ${attempt.text}`)
    }
    if (bookingResponse) break
  }

  assert.ok(bookingResponse, 'Expected at least one room to allow booking creation')
  assert.equal(
    bookingResponse.status,
    201,
    `Expected booking create 201, got ${bookingResponse.status}: ${bookingResponse.text}`,
  )
  assert.ok(bookingResponse.json?.customerId, `Expected booking.customerId: ${bookingResponse.text}`)
  assert.equal(bookingResponse.json?.guestPhone, phone)
  bookingId = bookingResponse.json.id

  const last4 = phone.slice(-4)
  const searchResponse = await api(`/api/customers?q=${encodeURIComponent(last4)}`, {
    headers: {
      'X-Club-Id': hostClubId,
    },
  })
  assert.equal(
    searchResponse.status,
    200,
    `Expected customer search 200, got ${searchResponse.status}: ${searchResponse.text}`,
  )
  const matches = (searchResponse.json?.items || []).filter((item) => item.phone === phone)
  assert.equal(matches.length, 1, `Expected exactly one customer match by phone, got ${matches.length}`)
})

test('duplicate phone update returns 409 conflict', async () => {
  const unique = `${Date.now()}`
  const phoneA = `+7717${unique.slice(-7)}`
  const phoneB = `+7727${unique.slice(-7)}`

  const customerA = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `A-${unique}`,
      phone: phoneA,
    }),
  })
  assert.ok(
    customerA.status === 200 || customerA.status === 201,
    `Expected customerA upsert success, got ${customerA.status}: ${customerA.text}`,
  )

  const customerB = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `B-${unique}`,
      phone: phoneB,
    }),
  })
  assert.ok(
    customerB.status === 200 || customerB.status === 201,
    `Expected customerB create/upsert success, got ${customerB.status}: ${customerB.text}`,
  )

  const customerBId = customerB.json?.customerId
  assert.ok(customerBId, `Expected customerB id: ${customerB.text}`)

  const conflict = await api(`/api/customers/${customerBId}`, {
    method: 'PUT',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      phone: phoneA,
    }),
  })
  assert.equal(conflict.status, 409, `Expected 409 conflict, got ${conflict.status}: ${conflict.text}`)
  assert.equal(conflict.json?.code, 'DUPLICATE_PHONE')
})

test('attach_customer rebinds existing booking to selected customer', async () => {
  assert.ok(bookingId > 0, 'Expected previous booking id from auto-link test')
  const unique = `${Date.now()}`
  const attachTarget = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `Attach-${unique}`,
      phone: `+7733${unique.slice(-7)}`,
    }),
  })
  assert.ok(
    attachTarget.status === 200 || attachTarget.status === 201,
    `Expected attach target create success, got ${attachTarget.status}: ${attachTarget.text}`,
  )
  const targetId = attachTarget.json?.customerId
  assert.ok(targetId, `Expected customer id: ${attachTarget.text}`)

  const attached = await api(`/api/bookings/${bookingId}`, {
    method: 'PATCH',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      action: 'attach_customer',
      customerId: targetId,
    }),
  })
  assert.equal(attached.status, 200, `Expected attach_customer 200, got ${attached.status}: ${attached.text}`)
  assert.equal(attached.json?.customerId, targetId)
})

test('customer profile is club-scoped and not accessible from another club', async () => {
  await setContext({ userEmail: 'azamat@example.com' })
  const me = await api('/api/me')
  assert.equal(me.status, 200, `Expected /api/me 200, got ${me.status}: ${me.text}`)
  const clubs = me.json?.clubs || []
  assert.ok(clubs.length >= 2, `Expected azamat to have >=2 clubs, got ${clubs.length}`)
  const clubA = clubs[0].id
  const clubB = clubs[1].id
  assert.notEqual(clubA, clubB, 'Expected two distinct clubs')

  await setContext({ clubId: clubA, role: 'TECH_ADMIN' })
  const created = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': clubA },
    body: JSON.stringify({
      displayName: `Isolation-${Date.now()}`,
      phone: `+7744${String(Date.now()).slice(-7)}`,
    }),
  })
  assert.ok(
    created.status === 200 || created.status === 201,
    `Expected customer create in clubA success, got ${created.status}: ${created.text}`,
  )
  const customerId = created.json?.customerId
  assert.ok(customerId, `Expected customer id: ${created.text}`)

  const crossClubRead = await api(`/api/customers/${customerId}`, {
    headers: { 'X-Club-Id': clubB },
  })
  assert.equal(
    crossClubRead.status,
    404,
    `Expected cross-club customer read to return 404, got ${crossClubRead.status}: ${crossClubRead.text}`,
  )

  await setContext({ userEmail: 'host@example.com' })
  await setContext({ clubId: hostClubId, role: 'HOST_ADMIN' })
})

test('host cannot edit notes created by another staff member', async () => {
  await setContext({ userEmail: 'tech@example.com' })
  await setContext({ clubId: hostClubId, role: 'TECH_ADMIN' })

  const unique = `${Date.now()}`
  const customer = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `NoteOwner-${unique}`,
      phone: `+7755${unique.slice(-7)}`,
    }),
  })
  assert.ok(
    customer.status === 200 || customer.status === 201,
    `Expected customer create/upsert success, got ${customer.status}: ${customer.text}`,
  )
  const customerId = customer.json?.customerId
  assert.ok(customerId, `Expected customer id: ${customer.text}`)

  const note = await api(`/api/customers/${customerId}/notes`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({ text: 'Created by tech admin' }),
  })
  assert.equal(note.status, 201, `Expected note create 201, got ${note.status}: ${note.text}`)
  const noteId = note.json?.noteId
  assert.ok(noteId, `Expected note id: ${note.text}`)

  await setContext({ userEmail: 'host@example.com' })
  await setContext({ clubId: hostClubId, role: 'HOST_ADMIN' })

  const forbiddenEdit = await api(`/api/customers/${customerId}/notes/${noteId}`, {
    method: 'PUT',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({ text: 'Host attempt edit' }),
  })
  assert.equal(forbiddenEdit.status, 403, `Expected 403, got ${forbiddenEdit.status}: ${forbiddenEdit.text}`)
  assert.equal(forbiddenEdit.json?.code, 'INSUFFICIENT_PERMISSION')
})

test('tech admin can merge duplicate customers and merged status is visible in filters', async () => {
  await setContext({ userEmail: 'tech@example.com' })
  await setContext({ clubId: hostClubId, role: 'TECH_ADMIN' })

  const unique = `${Date.now()}`
  const primary = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `Primary-${unique}`,
      phone: `+7766${unique.slice(-7)}`,
    }),
  })
  assert.ok(primary.status === 200 || primary.status === 201, `Primary create failed: ${primary.status} ${primary.text}`)
  const primaryId = primary.json?.customerId
  assert.ok(primaryId, `Expected primary customer id: ${primary.text}`)

  const secondary = await api('/api/customers', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      displayName: `Secondary-${unique}`,
      phone: `+7777${unique.slice(-7)}`,
    }),
  })
  assert.ok(secondary.status === 200 || secondary.status === 201, `Secondary create failed: ${secondary.status} ${secondary.text}`)
  const secondaryId = secondary.json?.customerId
  assert.ok(secondaryId, `Expected secondary customer id: ${secondary.text}`)

  const tag = await api(`/api/customers/${secondaryId}/tags`, {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({ tag: 'MergeCandidate' }),
  })
  assert.equal(tag.status, 201, `Expected tag create 201, got ${tag.status}: ${tag.text}`)

  const merge = await api('/api/customers/merge', {
    method: 'POST',
    headers: { 'X-Club-Id': hostClubId },
    body: JSON.stringify({
      primaryCustomerId: primaryId,
      mergedCustomerId: secondaryId,
      reason: 'Duplicate customer record',
    }),
  })
  assert.equal(merge.status, 200, `Expected merge 200, got ${merge.status}: ${merge.text}`)
  assert.equal(merge.json?.primaryCustomerId, primaryId)
  assert.equal(merge.json?.mergedCustomerId, secondaryId)

  const mergedProfile = await api(`/api/customers/${secondaryId}`, {
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(mergedProfile.status, 200, `Expected merged profile read 200, got ${mergedProfile.status}: ${mergedProfile.text}`)
  assert.equal(mergedProfile.json?.status, 'MERGED')

  const mergedFilter = await api('/api/customers?status=merged', {
    headers: { 'X-Club-Id': hostClubId },
  })
  assert.equal(mergedFilter.status, 200, `Expected merged filter 200, got ${mergedFilter.status}: ${mergedFilter.text}`)
  assert.ok(
    Array.isArray(mergedFilter.json?.items) &&
      mergedFilter.json.items.some((item) => item.customerId === secondaryId),
    'Expected merged customer in status=merged filter',
  )
})
