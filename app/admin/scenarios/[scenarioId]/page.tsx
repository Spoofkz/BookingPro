import { notFound } from 'next/navigation'
import { AdminShell } from '@/src/components/admin/AdminShell'

type PageProps = {
  params: Promise<{ scenarioId: string }>
}

export default async function ScenarioDetailPage({ params }: PageProps) {
  const { scenarioId } = await params
  const normalized = scenarioId.trim()
  if (!normalized) {
    notFound()
  }

  return <AdminShell section="scenarios" scenarioId={normalized} />
}
