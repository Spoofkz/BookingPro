import TechSection from '@/src/components/cabinet/TechSection'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ section: string }>
}

export default async function Page({ params }: PageProps) {
  const { section } = await params
  return <TechSection section={section} />
}
