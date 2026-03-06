import { notFound } from 'next/navigation'
import ClientInvoiceDetailsPage from '@/src/components/client/ClientInvoiceDetailsPage'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const invoiceId = id.trim()
  if (!invoiceId) {
    notFound()
  }
  return <ClientInvoiceDetailsPage invoiceId={invoiceId} />
}
