import crypto from 'crypto'

function getProviderSecretKeyName(provider: string) {
  const normalized = provider.trim().toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return `${normalized}_WEBHOOK_SECRET`
}

export function getWebhookSecret(provider: string) {
  const providerSecret = process.env[getProviderSecretKeyName(provider)]
  if (providerSecret && providerSecret.trim()) return providerSecret.trim()

  const globalSecret = process.env.PAYMENT_WEBHOOK_SECRET
  if (globalSecret && globalSecret.trim()) return globalSecret.trim()

  if (process.env.NODE_ENV !== 'production') return 'dev-webhook-secret'
  return ''
}

export function signWebhookPayload(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyWebhookSignature(params: {
  provider: string
  rawBody: string
  signature: string | null
}) {
  const signature = (params.signature || '').trim()
  if (!signature) return false
  const secret = getWebhookSecret(params.provider)
  if (!secret) return false

  const expected = signWebhookPayload(params.rawBody, secret)
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (providedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}
