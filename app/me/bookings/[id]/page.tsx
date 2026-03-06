import ClientBookingDetailsPage from '@/src/components/client/ClientBookingDetailsPage'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  const bookingId = Number(id)
  if (!Number.isInteger(bookingId) || bookingId < 1) {
    notFound()
  }
  return <ClientBookingDetailsPage bookingId={bookingId} />
}
