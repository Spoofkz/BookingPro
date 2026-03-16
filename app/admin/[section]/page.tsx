import { notFound } from 'next/navigation'
import { AdminShell } from '@/src/components/admin/AdminShell'

const ALLOWED_SECTIONS = new Set([
  'clubs',
  'users',
  'bookings',
  'disputes',
  'featured',
  'audit',
  'scenarios',
  'readiness',
  'account',
])

type AdminSection =
  | 'clubs'
  | 'users'
  | 'bookings'
  | 'disputes'
  | 'featured'
  | 'audit'
  | 'scenarios'
  | 'readiness'
  | 'account'

type PageProps = {
  params: Promise<{ section: string }>
}

export default async function AdminSectionPage({ params }: PageProps) {
  const { section } = await params
  if (!ALLOWED_SECTIONS.has(section)) {
    notFound()
  }

  return <AdminShell section={section as AdminSection} />
}
