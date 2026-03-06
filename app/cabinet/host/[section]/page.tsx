import HostSection from '@/src/components/cabinet/HostSection'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ section: string }>
}

export default async function Page({ params }: PageProps) {
  const { section } = await params
  return <HostSection section={section} />
}
