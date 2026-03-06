import { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import CabinetChrome from '@/src/components/cabinet/CabinetChrome'
import { getCabinetContext } from '@/src/lib/cabinetContext'

export const dynamic = 'force-dynamic'

export default async function CabinetLayout({ children }: { children: ReactNode }) {
  const context = await getCabinetContext({ requireSession: true }).catch(() => null)
  if (!context) {
    redirect('/auth/client')
  }

  return <CabinetChrome>{children}</CabinetChrome>
}
