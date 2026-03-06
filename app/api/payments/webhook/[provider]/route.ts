import { NextRequest } from 'next/server'
import { handlePaymentWebhook } from '@/src/lib/paymentWebhookHandler'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ provider: string }>
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { provider } = await routeContext.params
  return handlePaymentWebhook(request, provider)
}
