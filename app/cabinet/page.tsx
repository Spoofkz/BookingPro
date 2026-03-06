import { redirect } from 'next/navigation'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const context = await getCabinetContext({ requireSession: true })

  if (context.activeRole === 'HOST_ADMIN') {
    redirect('/cabinet/host/today')
  }

  if (context.activeRole === 'TECH_ADMIN') {
    redirect('/cabinet/tech/overview')
  }

  redirect('/cabinet/client/dashboard')
}
