import { NextRequest } from 'next/server'
import { handlePaymentWebhook } from '@/src/lib/paymentWebhookHandler'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return handlePaymentWebhook(request, 'MOCK_PROVIDER')
}
