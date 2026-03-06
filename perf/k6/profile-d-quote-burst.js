import http from 'k6/http'
import { check } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3001'
const CLUB_ID = __ENV.CLUB_ID || ''
const ROOM_ID = Number(__ENV.ROOM_ID || 0)
const SEGMENT_ID = __ENV.SEGMENT_ID || ''
const PROMO_CODE = __ENV.PROMO_CODE || ''
const COOKIE = __ENV.COOKIE || ''

function isoAfterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

export const options = {
  scenarios: {
    quote_burst: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 500),
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 100),
      maxVUs: Number(__ENV.MAX_VUS || 800),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<250'],
  },
}

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (COOKIE) h.Cookie = COOKIE
  return h
}

export default function () {
  if (!CLUB_ID || !ROOM_ID || !SEGMENT_ID) {
    throw new Error('CLUB_ID, ROOM_ID, SEGMENT_ID env vars are required')
  }

  const body = {
    clubId: CLUB_ID,
    roomId: ROOM_ID,
    segmentId: SEGMENT_ID,
    startAt: isoAfterMinutes(60),
    endAt: isoAfterMinutes(180),
    channel: 'ONLINE',
    customerType: 'GUEST',
  }
  if (PROMO_CODE) body.promoCode = PROMO_CODE

  const res = http.post(`${BASE_URL}/api/pricing/quote`, JSON.stringify(body), {
    headers: headers(),
    tags: { profile: 'D', endpoint: 'pricing.quote' },
  })

  check(res, {
    'quote returns 200': (r) => r.status === 200,
    'quote has total field': (r) => {
      try {
        return typeof JSON.parse(r.body).total === 'number'
      } catch {
        return false
      }
    },
  })
}

