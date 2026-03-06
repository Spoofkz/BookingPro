import HostCustomerProfile from '@/src/components/cabinet/HostCustomerProfile'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ customerId: string }>
}

export default async function Page({ params }: PageProps) {
  const { customerId } = await params
  return <HostCustomerProfile customerId={customerId} />
}
