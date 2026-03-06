import ClientSection from '@/src/components/cabinet/ClientSection'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ section: string }>
}

export default async function Page({ params }: PageProps) {
  const { section } = await params
  return <ClientSection section={section} />
}
